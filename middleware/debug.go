package middleware

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/pressly/chi"
	"golang.org/x/net/context"
)

func LogRequestHeaders(next chi.Handler) chi.Handler {
	fn := func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		data, _ := json.MarshalIndent(r.Header, "", "  ")
		log.Printf("Request headers:\n%s\n", data)

		next.ServeHTTPC(ctx, w, r)
	}

	return chi.HandlerFunc(fn)
}

func LogResponseHeaders(next chi.Handler) chi.Handler {
	fn := func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		next.ServeHTTPC(ctx, w, r)

		data, _ := json.MarshalIndent(w.Header(), "", "  ")
		log.Printf("Response headers:\n%s\n", data)
	}

	return chi.HandlerFunc(fn)
}
