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

	r.Get("/", getArticle)                                      // API version 3 (latest).
	r.Get("/v3", getArticle)                                    // API version 3.
	r.Get("/v2", render.UsePresenter(v2.Presenter), getArticle) // API version 2.
	r.Get("/v1", render.UsePresenter(v1.Presenter), getArticle) // API version 1.

	r.Get("/error", randomErrorHandler)

	http.ListenAndServe(":3333", r)
}

func getArticle(ctx context.Context, w http.ResponseWriter, r *http.Request) {
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
		ctx = context.WithValue(ctx, "auth", true)
	}
	if r.URL.Query().Get("error") != "" {
		render.Respond(ctx, w, errors.New("error"))
		return
	}

	render.Respond(ctx, w, article)
}

func randomErrorHandler(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	errors := []error{data.ErrUnauthorized, data.ErrForbidden, data.ErrNotFound}

	rand.Seed(time.Now().Unix())
	render.Respond(ctx, w, errors[rand.Intn(len(errors))])
}

func init() {
	// custom responder that sets response status code based on Error value/type.
	render.Respond = func(ctx context.Context, w http.ResponseWriter, v interface{}) {
		val := reflect.ValueOf(v)
		if err, ok := val.Interface().(error); ok {
			switch err {
			case data.ErrUnauthorized:
				ctx = render.Status(ctx, 401)
			case data.ErrForbidden:
				ctx = render.Status(ctx, 403)
			case data.ErrNotFound:
				ctx = render.Status(ctx, 404)
			default:
				ctx = render.Status(ctx, 500)
			}
			render.DefaultRespond(ctx, w, map[string]string{"error": err.Error()})
			return
		}

		render.DefaultRespond(ctx, w, v)
	}
}
