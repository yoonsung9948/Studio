package blob

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
)

// Local stores files in a directory on disk. It suits development and a
// single server; use an object store (S3, R2) when running several servers.
type Local struct {
	root string
}

// NewLocal uses dir as the store's root, creating it if needed.
func NewLocal(dir string) (*Local, error) {
	root, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, fmt.Errorf("create blob directory: %w", err)
	}
	return &Local{root: root}, nil
}

func (s *Local) path(key string) (string, error) {
	if err := CheckKey(key); err != nil {
		return "", err
	}
	return filepath.Join(s.root, filepath.FromSlash(key)), nil
}

func (s *Local) Put(ctx context.Context, key string, r io.Reader) (Info, error) {
	dst, err := s.path(key)
	if err != nil {
		return Info{}, err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return Info{}, err
	}
	// Write to a temporary file in the same directory, then rename: readers
	// never see a partial file, and a failed write leaves the old file intact.
	tmp, err := os.CreateTemp(filepath.Dir(dst), ".upload-*")
	if err != nil {
		return Info{}, err
	}
	defer os.Remove(tmp.Name()) // no-op after a successful rename
	size, err := io.Copy(tmp, contextReader{ctx, r})
	if err == nil {
		err = tmp.Sync()
	}
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return Info{}, fmt.Errorf("write blob %s: %w", key, err)
	}
	if err := os.Rename(tmp.Name(), dst); err != nil {
		return Info{}, err
	}
	stat, err := os.Stat(dst)
	if err != nil {
		return Info{}, err
	}
	return Info{Key: key, Size: size, ContentType: ContentType(key), ModTime: stat.ModTime()}, nil
}

func (s *Local) Open(_ context.Context, key string) (Object, error) {
	p, err := s.path(key)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(p)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, fmt.Errorf("%w: %s", ErrNotFound, key)
	}
	if err != nil {
		return nil, err
	}
	stat, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	if !stat.Mode().IsRegular() {
		f.Close()
		return nil, fmt.Errorf("%w: %s", ErrNotFound, key)
	}
	return &localObject{File: f, info: Info{Key: key, Size: stat.Size(), ContentType: ContentType(key), ModTime: stat.ModTime()}}, nil
}

type localObject struct {
	*os.File
	info Info
}

func (o *localObject) Info() Info { return o.info }

// contextReader stops a long copy when ctx is cancelled.
type contextReader struct {
	ctx context.Context
	r   io.Reader
}

func (c contextReader) Read(p []byte) (int, error) {
	if err := c.ctx.Err(); err != nil {
		return 0, err
	}
	return c.r.Read(p)
}
