package middleware_test

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/iotest"

	"github.com/go-chi/chi/v5/middleware"
)

func TestWrapResponseWriterReadFromStatus(t *testing.T) {
	readErr := errors.New("upstream failed")
	for _, tc := range []struct {
		name          string
		reader        io.Reader
		initialStatus int
		wantStatus    int
		wantBytes     int
		wantErr       bool
	}{
		{name: "empty source", reader: strings.NewReader(""), wantStatus: http.StatusAccepted},
		{name: "failed source", reader: iotest.ErrReader(readErr), wantStatus: http.StatusBadGateway, wantErr: true},
		{name: "successful source", reader: strings.NewReader("ok"), wantStatus: http.StatusOK, wantBytes: 2},
		{name: "partial source", reader: io.MultiReader(strings.NewReader("partial"), iotest.ErrReader(readErr)), wantStatus: http.StatusOK, wantBytes: 7, wantErr: true},
		{name: "explicit status", reader: iotest.ErrReader(readErr), initialStatus: http.StatusCreated, wantStatus: http.StatusCreated, wantErr: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			type result struct {
				status, bytes int
				copied        int64
				err           error
			}
			results := make(chan result, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				wrapped := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
				if tc.initialStatus != 0 {
					wrapped.WriteHeader(tc.initialStatus)
				}
				// Hide WriterTo so io.Copy exercises the response writer's ReaderFrom.
				n, err := io.Copy(wrapped, struct{ io.Reader }{tc.reader})
				if n == 0 {
					if err != nil {
						wrapped.WriteHeader(http.StatusBadGateway)
					} else {
						wrapped.WriteHeader(http.StatusAccepted)
					}
				}
				results <- result{status: wrapped.Status(), bytes: wrapped.BytesWritten(), copied: n, err: err}
			}))
			defer server.Close()
			resp, err := server.Client().Get(server.URL)
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			if _, err := io.Copy(io.Discard, resp.Body); err != nil {
				t.Fatal(err)
			}
			got := <-results
			if resp.StatusCode != tc.wantStatus || got.status != tc.wantStatus {
				t.Errorf("client status = %d, wrapper status = %d, want %d", resp.StatusCode, got.status, tc.wantStatus)
			}
			if got.bytes != tc.wantBytes || got.copied != int64(tc.wantBytes) {
				t.Errorf("BytesWritten = %d, copied = %d, want %d", got.bytes, got.copied, tc.wantBytes)
			}
			if tc.wantErr && !errors.Is(got.err, readErr) || !tc.wantErr && got.err != nil {
				t.Errorf("copy error = %v, want upstream error = %t", got.err, tc.wantErr)
			}
		})
	}
}
