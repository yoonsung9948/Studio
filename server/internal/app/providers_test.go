package app

import (
	"bytes"
	"context"
	"io"
	"testing"
)

func TestDefaultVideoSampleIsBundled(t *testing.T) {
	model, err := (&App{}).videoModel()
	if err != nil {
		t.Fatal(err)
	}
	file, err := model.Download(context.Background(), "sample")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	data, err := io.ReadAll(file)
	if err != nil || !bytes.Equal(data, defaultVideoSample) || len(data) < 32 || !bytes.Contains(data[:32], []byte("ftyp")) {
		t.Fatalf("default sample is not an MP4: %v", err)
	}
}
