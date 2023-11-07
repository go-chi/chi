package main

import (
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
)

func main() {
	r := chi.NewRouter()
	r.Use(FindPatternMiddleware(r))

	r.Get("/hello/{name}", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(fmt.Sprintf("hello, %s", chi.URLParam(r, "name"))))
	})

	http.ListenAndServe(":3333", r)
}

// Middleware that prints the route pattern before the request is handled
func FindPatternMiddleware(router chi.Router) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			rctx := chi.NewRouteContext()
			path := r.URL.Path
			op := r.Method
			pattern := router.Find(rctx, op, path)

			fmt.Printf("pattern=%s\n", pattern)

			next.ServeHTTP(w, r)
		})
	}
}
