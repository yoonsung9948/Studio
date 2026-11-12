package openai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	imageinput "nori/studio/server/internal/domain/image"
	"nori/studio/server/internal/platform/blob"
	"nori/studio/server/internal/providers"
)

const DefaultImageModel = "gpt-image-2.5-sunburst"
const maxResponseBytes = 48 << 20
const maxImageBytes = 32 << 20

var sizes = map[string]string{"1:1": "1024x1024", "16:9": "1536x864", "9:16": "864x1536"}

type Image struct {
	key, model, baseURL string
	client              *http.Client
	files               blob.Store
	calls               callStore
}

func NewImage(key, model string, files blob.Store, pool *pgxpool.Pool) (*Image, error) {
	if strings.TrimSpace(key) == "" || files == nil || pool == nil {
		return nil, errors.New("OpenAI images require an API key, storage, and database")
	}
	if model == "" {
		model = DefaultImageModel
	}
	if !SupportedModel(model) {
		return nil, errors.New("unsupported OpenAI image model")
	}
	return &Image{key: key, model: model, baseURL: "https://api.openai.com/v1", client: &http.Client{Timeout: 3 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, files: files, calls: calls{pool}}, nil
}

func SupportedModel(model string) bool {
	return model == DefaultImageModel || model == DefaultImageModel+"-2026-09-08"
}
func (m *Image) Name() (string, string) { return "openai", m.model }
func (m *Image) Capabilities() providers.ImageCapabilities {
	return providers.ImageCapabilities{Model: m.model, AspectRatios: []string{"1:1", "16:9", "9:16"}, MaxReferences: 8, Editing: true}
}
func (m *Image) Generate(ctx context.Context, req providers.ImageRequest) (providers.ImageOutput, error) {
	return m.run(ctx, req, false)
}
func (m *Image) Edit(ctx context.Context, req providers.ImageRequest) (providers.ImageOutput, error) {
	return m.run(ctx, req, true)
}

// Responses are private durable receipts, not job state or public download URLs.
type receipt struct {
	Hash      string          `json:"hash"`
	Model     string          `json:"model"`
	RequestID string          `json:"requestId"`
	Response  json.RawMessage `json:"response"`
}

type imageResponse struct {
	Data []struct {
		Base64 string `json:"b64_json"`
	} `json:"data"`
	Usage   json.RawMessage `json:"usage"`
	Quality string          `json:"quality"`
}

func (m *Image) run(ctx context.Context, req providers.ImageRequest, edit bool) (providers.ImageOutput, error) {
	if _, err := uuid.Parse(req.IdempotencyKey); err != nil {
		return providers.ImageOutput{}, providers.ErrRejected
	}
	if req.Input.Validate() != nil || !m.Capabilities().Supports(req.Input, edit) || (edit && req.Source == nil) {
		return providers.ImageOutput{}, providers.ErrRejected
	}
	if req.Input.References == nil {
		req.Input.References = []imageinput.Reference{}
	}
	canonical, _ := json.Marshal(struct {
		Input imageinput.Input
		Edit  bool
	}{req.Input, edit})
	hash := fmt.Sprintf("%x", sha256.Sum256(canonical))
	prefix := "providers/openai/images/" + req.IdempotencyKey
	cached, err := m.files.Open(ctx, prefix+"/response.json")
	if err == nil {
		defer cached.Close()
		var saved receipt
		if json.NewDecoder(io.LimitReader(cached, maxResponseBytes+4096)).Decode(&saved) != nil || saved.Hash != hash || saved.Model != m.model {
			return providers.ImageOutput{}, providers.ErrUncertain
		}
		return m.finish(ctx, req.IdempotencyKey, prefix, saved)
	}
	if !errors.Is(err, blob.ErrNotFound) {
		return providers.ImageOutput{}, err
	}
	body, contentType, endpoint, err := m.request(req)
	if err != nil {
		return providers.ImageOutput{}, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, m.baseURL+endpoint, body)
	if err != nil {
		return providers.ImageOutput{}, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+m.key)
	httpReq.Header.Set("Content-Type", contentType)
	httpReq.Header.Set("X-Client-Request-Id", req.IdempotencyKey)
	claimed, err := m.calls.Claim(ctx, req.IdempotencyKey, hash, m.model)
	if err != nil {
		return providers.ImageOutput{}, err
	}
	if !claimed {
		return providers.ImageOutput{}, providers.ErrUncertain
	}
	response, err := m.client.Do(httpReq)
	if err != nil {
		return providers.ImageOutput{}, providers.ErrUncertain
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil || len(data) > maxResponseBytes {
		return providers.ImageOutput{}, providers.ErrUncertain
	}
	requestID := response.Header.Get("X-Request-Id")
	if response.StatusCode != http.StatusOK {
		return providers.ImageOutput{}, m.failure(ctx, req.IdempotencyKey, requestID, response, data)
	}
	saved := receipt{Hash: hash, Model: m.model, RequestID: requestID, Response: data}
	encoded, err := json.Marshal(saved)
	if err != nil {
		return providers.ImageOutput{}, providers.ErrRejected
	}
	if _, err := m.files.Put(ctx, prefix+"/response.json", bytes.NewReader(encoded)); err != nil {
		return providers.ImageOutput{}, err
	}
	return m.finish(ctx, req.IdempotencyKey, prefix, saved)
}

func (m *Image) finish(ctx context.Context, id, prefix string, saved receipt) (providers.ImageOutput, error) {
	var response imageResponse
	if json.Unmarshal(saved.Response, &response) != nil || len(response.Data) != 1 {
		return providers.ImageOutput{}, providers.ErrRejected
	}
	data, err := base64.StdEncoding.DecodeString(response.Data[0].Base64)
	if err != nil || len(data) > maxImageBytes {
		return providers.ImageOutput{}, providers.ErrRejected
	}
	config, err := png.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width < 1 || config.Height < 1 || config.Width > 16384 || config.Height > 16384 {
		return providers.ImageOutput{}, providers.ErrRejected
	}
	key := prefix + "/image.png"
	if _, err := m.files.Put(ctx, key, bytes.NewReader(data)); err != nil {
		return providers.ImageOutput{}, err
	}
	quality := response.Quality
	if quality == "" {
		quality = "medium"
	}
	metadata, _ := json.Marshal(struct {
		Usage   json.RawMessage `json:"usage,omitempty"`
		Size    string          `json:"size"`
		Quality string          `json:"quality"`
		Width   int             `json:"width"`
		Height  int             `json:"height"`
	}{response.Usage, fmt.Sprintf("%dx%d", config.Width, config.Height), quality, config.Width, config.Height})
	if err := m.calls.Record(ctx, id, "completed", saved.RequestID, metadata); err != nil {
		return providers.ImageOutput{}, err
	}
	return providers.ImageOutput{File: key, ContentType: "image/png"}, nil
}

func (m *Image) Download(ctx context.Context, key string) (io.ReadCloser, error) {
	if !strings.HasPrefix(key, "providers/openai/images/") || !strings.HasSuffix(key, "/image.png") || blob.CheckKey(key) != nil {
		return nil, providers.ErrRejected
	}
	return m.files.Open(ctx, key)
}

func (m *Image) request(req providers.ImageRequest) (io.Reader, string, string, error) {
	prompt := req.Input.Prompt
	images := []providers.ImageReference{}
	if req.Source != nil {
		images = append(images, *req.Source)
	}
	images = append(images, req.References...)
	for i, ref := range images {
		prompt += fmt.Sprintf("\nInput image %d has role %s.", i+1, ref.Role)
	}
	if len(images) == 0 {
		data, err := json.Marshal(map[string]any{"model": m.model, "prompt": prompt, "n": 1, "size": sizes[req.Input.Settings.AspectRatio], "quality": "medium", "output_format": "png"})
		return bytes.NewReader(data), "application/json", "/images/generations", err
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for _, field := range [][2]string{{"model", m.model}, {"prompt", prompt}, {"n", "1"}, {"size", sizes[req.Input.Settings.AspectRatio]}, {"quality", "medium"}, {"output_format", "png"}} {
		if err := writer.WriteField(field[0], field[1]); err != nil {
			return nil, "", "", err
		}
	}
	var total int64
	for i, ref := range images {
		ext := map[string]string{"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}[ref.ContentType]
		if ext == "" || ref.Reader == nil {
			return nil, "", "", providers.ErrRejected
		}
		header := make(textproto.MIMEHeader)
		header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="image[]"; filename="input-%d.%s"`, i+1, ext))
		header.Set("Content-Type", ref.ContentType)
		part, err := writer.CreatePart(header)
		if err != nil {
			return nil, "", "", err
		}
		n, err := io.Copy(part, io.LimitReader(ref.Reader, maxImageBytes+1))
		if err != nil {
			return nil, "", "", err
		}
		total += n
		if n > maxImageBytes || total > 64<<20 {
			return nil, "", "", providers.ErrRejected
		}
	}
	if err := writer.Close(); err != nil {
		return nil, "", "", err
	}
	return &body, writer.FormDataContentType(), "/images/edits", nil
}

func (m *Image) failure(ctx context.Context, id, requestID string, response *http.Response, data []byte) error {
	var detail struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(data, &detail)
	status := "failed"
	var failure error = providers.ErrRejected
	switch {
	case response.StatusCode == http.StatusTooManyRequests && detail.Error.Code != "insufficient_quota":
		status = "retryable"
		after := time.Second
		if seconds, err := strconv.Atoi(response.Header.Get("Retry-After")); err == nil && seconds > 0 {
			after = time.Duration(min(seconds, 300)) * time.Second
		}
		if date, err := http.ParseTime(response.Header.Get("Retry-After")); err == nil {
			after = min(max(time.Until(date), time.Second), 5*time.Minute)
		}
		failure = &providers.RateLimitedError{RetryAfter: after}
	case detail.Error.Code == "insufficient_quota":
		failure = providers.ErrQuota
	case response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden:
		failure = providers.ErrUnauthorized
	case response.StatusCode >= 500 || response.StatusCode == http.StatusRequestTimeout:
		return providers.ErrUncertain
	}
	metadata, _ := json.Marshal(map[string]any{"httpStatus": response.StatusCode, "errorCode": detail.Error.Code})
	if err := m.calls.Record(ctx, id, status, requestID, metadata); err != nil {
		return err
	}
	return failure
}
