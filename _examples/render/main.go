package main

import (
	"errors"
	"math/rand"
	"net/http"
	"reflect"
	"time"

	"golang.org/x/net/context"

	"github.com/pressly/chi"
	"github.com/pressly/chi/_examples/render/data"
	"github.com/pressly/chi/_examples/render/presenter/v1"
	"github.com/pressly/chi/_examples/render/presenter/v2"
	"github.com/pressly/chi/_examples/render/presenter/v3"
	"github.com/pressly/chi/middleware"
	"github.com/pressly/chi/render"
)

func main() {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(render.ParseContentType)
	r.Use(render.UsePresenter(v3.Presenter)) // API version 3 (latest) by default.

	// API version 3.
	r.Get("/", redirectV3)
	r.Route("/v3", func(r chi.Router) {
		r.Use(render.UsePresenter(v3.Presenter))
		r.Get("/", getArticle)
	})

	// API version 2.
	r.Route("/v2", func(r chi.Router) {
		r.Use(render.UsePresenter(v2.Presenter))
		r.Get("/", getArticle)
	})

	// API version 1.
	r.Route("/v1", func(r chi.Router) {
		r.Use(render.UsePresenter(v1.Presenter))
		r.Get("/", getArticle)
	})

	r.Get("/error", randomErrorHandler)

	http.ListenAndServe(":3333", r)
}

func getArticle(w http.ResponseWriter, r *http.Request) {
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

	render.Respond(w, r, article)
}

func redirectV3(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, "/v3", 302)
}

func randomErrorHandler(w http.ResponseWriter, r *http.Request) {
	errors := []error{data.ErrUnauthorized, data.ErrForbidden, data.ErrNotFound}

	rand.Seed(time.Now().Unix())
	render.Respond(w, r, errors[rand.Intn(len(errors))])
}

func init() {
	// custom responder that sets response status code based on Error value/type.
	render.Respond = func(w http.ResponseWriter, r *http.Request, v interface{}) {
		val := reflect.ValueOf(v)
		if err, ok := val.Interface().(error); ok {
			switch err {
			case data.ErrUnauthorized:
				r = render.Status(r, 401)
			case data.ErrForbidden:
				r = render.Status(r, 403)
			case data.ErrNotFound:
				r = render.Status(r, 404)
			default:
				r = render.Status(r, 500)
			}
			render.DefaultRespond(w, r, map[string]string{"error": err.Error()})
			return
		}

		render.DefaultRespond(w, r, v)
	}
}
