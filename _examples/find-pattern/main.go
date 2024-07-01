package main

import (
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

func main() {
	r := chi.NewRouter()
	r.Use(middleware.FindPattern(r, func(pattern string) {
		fmt.Printf("pattern=%s\n", pattern)
	}))

	r.Get("/hello/{name}", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(fmt.Sprintf("hello, %s", chi.URLParam(r, "name"))))
	})

	http.ListenAndServe(":3333", r)
}
