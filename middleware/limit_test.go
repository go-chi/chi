package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi"
)

func TestLimit(t *testing.T) {
	type test struct {
		name      string
		b         int
		respCodes []int
	}
	tests := []test{
		{
			name:      "no-block",
			b:         3,
			respCodes: []int{200, 200, 200},
		},
		{
			name:      "block",
			b:         3,
			respCodes: []int{200, 200, 200, 429},
		},
	}
	for i, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := chi.NewRouter()
			r.Use(Limit(1, tt.b))
			r.Get("/", func(w http.ResponseWriter, r *http.Request) {})
			for _, code := range tt.respCodes {
				req := httptest.NewRequest("GET", "/", nil)
				rec := httptest.NewRecorder()
				r.ServeHTTP(rec, req)
				if respCode := rec.Result().StatusCode; respCode != code {
					t.Errorf("resp.StatusCode(%v) = %v, want %v", i, respCode, code)
				}
			}
		})
	}
}

func TestLimitIP(t *testing.T) {
	type test struct {
		name      string
		b         int
		reqIp     []string
		respCodes []int
	}
	tests := []test{
		{
			name:      "no-block",
			b:         1,
			reqIp:     []string{"1.1.1.1:100", "2.2.2.2:200"},
			respCodes: []int{200, 200},
		},
		{
			name:      "block-ip",
			b:         1,
			reqIp:     []string{"1.1.1.1:100", "1.1.1.1:100", "2.2.2.2:200"},
			respCodes: []int{200, 429, 200},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := chi.NewRouter()
			r.Use(LimitIP(1, tt.b))
			r.Get("/", func(w http.ResponseWriter, r *http.Request) {})
			for i, code := range tt.respCodes {
				req := httptest.NewRequest("GET", "/", nil)
				req.RemoteAddr = tt.reqIp[i]
				rec := httptest.NewRecorder()
				r.ServeHTTP(rec, req)
				if respCode := rec.Result().StatusCode; respCode != code {
					t.Errorf("resp.StatusCode(%v) = %v, want %v", i, respCode, code)
				}
			}
		})
	}
}
