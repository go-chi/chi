package main

import (
	"net/http"

	"github.com/pressly/chi"
	"github.com/pressly/chi/middleware"
)

func main() {
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("hello world"))
	})
	http.ListenAndServe(":3333", r)
}
