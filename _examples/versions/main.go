//
// Versions
// ========
// This example demonstrates the use of the render subpackage, with
// a quick concept for how to support multiple api versions.
//
package main

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"net/http"
	"time"

	"github.com/go-chi/chi"
	"github.com/go-chi/chi/_examples/versions/data"
	"github.com/go-chi/chi/_examples/versions/presenter/v1"
	"github.com/go-chi/chi/_examples/versions/presenter/v2"
	"github.com/go-chi/chi/_examples/versions/presenter/v3"
	"github.com/go-chi/chi/middleware"
	"github.com/go-chi/chi/render"
)

func main() {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	// API version 3.
	r.Route("/v3", func(r chi.Router) {
		r.Use(apiVersionCtx("v3"))
		r.Mount("/articles", articleRouter())
	})

	// API version 2.
	r.Route("/v2", func(r chi.Router) {
		r.Use(apiVersionCtx("v2"))
		r.Mount("/articles", articleRouter())
	})

	// API version 1.
	r.Route("/v1", func(r chi.Router) {
		r.Use(randomErrorMiddleware) // Simulate random error, ie. version 1 is buggy.
		r.Use(apiVersionCtx("v1"))
		r.Mount("/articles", articleRouter())
	})

	http.ListenAndServe(":3333", r)
}

func apiVersionCtx(version string) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r = r.WithContext(context.WithValue(r.Context(), "api.version", version))
			next.ServeHTTP(w, r)
		})
	}
}

func articleRouter() http.Handler {
	r := chi.NewRouter()
	r.Get("/", listArticles)
	r.Route("/{articleID}", func(r chi.Router) {
		r.Get("/", getArticle)
		// r.Put("/", updateArticle)
		// r.Delete("/", deleteArticle)
	})
	return r
}

func listArticles(w http.ResponseWriter, r *http.Request) {
	articles := make(chan render.Renderer, 5)

	// Load data asynchronously into the channel (simulate slow storage):
	go func() {
		for i := 1; i <= 10; i++ {
			article := &data.Article{
				ID:    i,
				Title: fmt.Sprintf("Article #%v", i),
				Data:  []string{"one", "two", "three", "four"},
				CustomDataForAuthUsers: "secret data for auth'd users only",
			}

			apiVersion := r.Context().Value("api.version").(string)
			switch apiVersion {
			case "v1":
				articles <- v1.NewArticleResponse(article)
			case "v2":
				articles <- v2.NewArticleResponse(article)
			default:
				articles <- v3.NewArticleResponse(article)
			}

			time.Sleep(100 * time.Millisecond)
		}
		close(articles)
	}()

	// Start streaming data from the channel.
	render.Respond(w, r, articles)
}

func getArticle(w http.ResponseWriter, r *http.Request) {
	// Load article.
	if chi.URLParam(r, "articleID") != "1" {
		render.Respond(w, r, data.ErrNotFound)
		return
	}
	article := &data.Article{
		ID:    1,
		Title: "Article #1",
		Data:  []string{"one", "two", "three", "four"},
		CustomDataForAuthUsers: "secret data for auth'd users only",
	}

	// Simulate some context values:
	// 1. ?auth=true simluates authenticated session/user.
	// 2. ?error=true simulates random error.
	if r.URL.Query().Get("auth") != "" {
		r = r.WithContext(context.WithValue(r.Context(), "auth", true))
	}
	if r.URL.Query().Get("error") != "" {
		render.Respond(w, r, errors.New("error"))
		return
	}

	var payload render.Renderer

	apiVersion := r.Context().Value("api.version").(string)
	switch apiVersion {
	case "v1":
		payload = v1.NewArticleResponse(article)
	case "v2":
		payload = v2.NewArticleResponse(article)
	default:
		payload = v3.NewArticleResponse(article)
	}

	render.Render(w, r, payload)
}

func randomErrorMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rand.Seed(time.Now().Unix())

		// One in three chance of random error.
		if rand.Int31n(3) == 0 {
			errors := []error{data.ErrUnauthorized, data.ErrForbidden, data.ErrNotFound}
			render.Respond(w, r, errors[rand.Intn(len(errors))])
			return
		}
		next.ServeHTTP(w, r)
	})
}
