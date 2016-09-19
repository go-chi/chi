//
// Versions
// ========
// This example demonstrates the use of the render subpackage and its
// render.Presenter interface to transform a handler response to easily
// handle API versioning.
//
package main

import (
	"math/rand"
	"net/http"
	"time"

	"github.com/pressly/chi"
	"github.com/pressly/chi/middleware"
	"github.com/pressly/chi/render"

	"github.com/pressly/chi/_examples/versions/articles"
	"github.com/pressly/chi/_examples/versions/data"
	"github.com/pressly/chi/_examples/versions/presenter/v1"
	"github.com/pressly/chi/_examples/versions/presenter/v2"
	"github.com/pressly/chi/_examples/versions/presenter/v3"
)

func main() {
	http.ListenAndServe(":3333", router())
}

func router() http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(render.UsePresenter(v3.Presenter)) // API version 3 (latest) by default.

	// Redirect for the Example convenience.
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/v3/articles/1", 302)
	})

	// API version 3.
	r.Route("/v3", func(r chi.Router) {
		r.Mount("/articles", articles.Router())
	})

	// API version 2.
	r.Route("/v2", func(r chi.Router) {
		r.Use(render.UsePresenter(v2.Presenter))
		r.Mount("/articles", articles.Router())
	})

	// API version 1.
	r.Route("/v1", func(r chi.Router) {
		r.Use(RandomErrorMiddleware) // Simulate random error, ie. version 1 has a bug.
		r.Use(render.UsePresenter(v1.Presenter))
		r.Mount("/articles", articles.Router())
	})

	return r
}

// Generates a random error with 1/3 chance.
func RandomErrorMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rand.Seed(time.Now().Unix())

		if rand.Int31n(3) == 0 {
			errors := []error{data.ErrUnauthorized, data.ErrForbidden, data.ErrNotFound}
			render.Respond(w, r, errors[rand.Intn(len(errors))])
			return
		}
		next.ServeHTTP(w, r)
	})
}
