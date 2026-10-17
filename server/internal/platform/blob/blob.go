// Package blob stores media files (images, video, audio) outside the database.
// Rows refer to files by key; the store holds the bytes.
package blob

import (
	"context"
	"errors"
	"io"
	"mime"
	"path"
	"strings"
	"time"
)

// Store saves and reads files by key. Keys are slash-separated paths such as
// "projects/<id>/jobs/<id>/video.mp4"; the extension decides the content type.
type Store interface {
	// Put writes the file, replacing any file with the same key. The file
	// becomes visible only once it is completely written.
	Put(ctx context.Context, key string, r io.Reader) (Info, error)
	// Open returns the file for reading and seeking (needed for video playback).
	// A missing key returns an error matching ErrNotFound.
	Open(ctx context.Context, key string) (Object, error)
}

// Object is an open file. Close it when done.
type Object interface {
	io.ReadSeekCloser
	Info() Info
}

type Info struct {
	Key         string
	Size        int64
	ContentType string
	ModTime     time.Time
}

var (
	ErrNotFound   = errors.New("blob not found")
	ErrInvalidKey = errors.New("invalid blob key")
)

const maxKeyLength = 512

// CheckKey rejects keys that could escape the store or are awkward in URLs:
// empty or "." / ".." segments, leading or trailing slashes, and characters
// other than letters, digits, '-', '_', '.' and '/'.
func CheckKey(key string) error {
	if key == "" || len(key) > maxKeyLength || strings.HasPrefix(key, "/") || strings.HasSuffix(key, "/") {
		return ErrInvalidKey
	}
	for _, segment := range strings.Split(key, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return ErrInvalidKey
		}
	}
	for _, r := range key {
		ok := r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_' || r == '.' || r == '/'
		if !ok {
			return ErrInvalidKey
		}
	}
	return nil
}

// mediaTypes are fixed here because Go's built-in table lacks most video and
// audio types, and the system's tables differ between machines.
var mediaTypes = map[string]string{
	".mp4":  "video/mp4",
	".webm": "video/webm",
	".mov":  "video/quicktime",
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".mp3":  "audio/mpeg",
	".m4a":  "audio/mp4",
	".wav":  "audio/wav",
	".json": "application/json",
}

// ContentType returns the media type for a key's extension.
func ContentType(key string) string {
	ext := strings.ToLower(path.Ext(key))
	if t, ok := mediaTypes[ext]; ok {
		return t
	}
	if t := mime.TypeByExtension(ext); t != "" {
		return t
	}
	return "application/octet-stream"
}
