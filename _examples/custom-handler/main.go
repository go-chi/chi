package main

import (
	"errors"
	"net/http"

	"github.com/pressly/chi"
)

type Handler func(w http.ResponseWriter, r *http.Request) error

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if err := h(w, r); err != nil {
		// handle returned error here.
		w.WriteHeader(503)
		w.Write([]byte("bad"))
	}
}

func main() {
	r := chi.NewRouter()
	r.Method("GET", "/", Handler(fooHandler))
	http.ListenAndServe(":3333", r)
}

func fooHandler(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query().Get("err")

	if q != "" {
		return errors.New(q)
	}

	w.Write([]byte("foo"))
	return nil
}
