package main

import (
	"fmt"
	"net/http"

	"github.com/go-chi/chi"
)

func main() {
	r := chi.NewRouter()
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("root."))
	})

	r.Route("/road", func(r chi.Router) {
		r.Get("/left", func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte("left road"))
		})
		r.Post("/right", func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte("right road"))
		})
	})

	r.Put("/ping", Ping)

	methodCount := make(map[string]int)
	test := func(method string, route string, handler http.Handler, middlewares ...func(http.Handler) http.Handler) error {
		methodCount[method]++
		return nil
	}

	if err := chi.Walk(r, test); err != nil {
		fmt.Errorf("%+v", err)
	}

	for k, v := range methodCount {
		fmt.Printf("%d Routes use %s Method\n", v, k)
	}
}

// SearchArticles searches the Articles data for a matching article.
// It's just a stub, but you get the idea.
func Ping(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("pong"))
}
