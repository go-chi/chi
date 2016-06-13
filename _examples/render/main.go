package main

import (
	"errors"
	"fmt"
	"math/rand"
	"net/http"
	"reflect"
	"time"

	"golang.org/x/net/context"

	"github.com/pressly/chi"
	"github.com/pressly/chi/middleware"
	"github.com/pressly/chi/render"
)

type RuntimeObject struct {
	ID       int      `json:"id"`
	AuthData string   `json:"auth_data"`
	Data     []string `json:"data"`
}

type PresenterObject struct {
	*RuntimeObject `json:",inline"`

	URL   string `json:"url"`
	False bool   `json:"false"`

	// Omit by default. Show explicitly for auth'd users only.
	AuthData interface{} `json:"auth_data,omitempty"`
}

type PresenterObjectV2 struct {
	*PresenterObject `json:",inline"`

	ResourceURL string `json:"resource_url"`

	// Omit.
	URL interface{} `json:"url,omitempty"`
}

type PresenterObjectV1 struct {
	*PresenterObjectV2 `json:",inline"`

	Data map[string]bool `json:"data"`
}

var (
	ErrUnauthorized = errors.New("Unauthorized")
	ErrForbidden    = errors.New("Forbidden")
	ErrNotFound     = errors.New("Resource not found")
)

func main() {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(render.ParseContentType)

	render.DefaultPresenter.Register(func(ctx context.Context, from *RuntimeObject) (*PresenterObject, error) {
		to := &PresenterObject{
			RuntimeObject: from,
			URL:           fmt.Sprintf("https://api.example.com/objects/%v", from.ID),
		}
		// Only show to auth'd user.
		if _, ok := ctx.Value("auth").(bool); ok {
			to.AuthData = from.AuthData
		}
		return to, nil
	})

	v2 := render.NewPresenter()
	v2.Register(func(ctx context.Context, from *PresenterObject) (*PresenterObjectV2, error) {
		return &PresenterObjectV2{PresenterObject: from, ResourceURL: from.URL}, nil
	})
	v2.RegisterFrom(render.DefaultPresenter)

	v1 := render.NewPresenter()
	v1.Register(func(ctx context.Context, from *PresenterObjectV2) (*PresenterObjectV1, error) {
		to := &PresenterObjectV1{
			PresenterObjectV2: from,
			Data:              map[string]bool{},
		}
		for _, item := range from.Data {
			to.Data[item] = true
		}
		return to, nil
	})
	v1.RegisterFrom(v2)

	render.Respond = func(ctx context.Context, w http.ResponseWriter, v interface{}) {
		// Set response status based on Error value/type.
		val := reflect.ValueOf(v)
		if err, ok := val.Interface().(error); ok {
			switch err {
			case ErrUnauthorized:
				ctx = render.Status(ctx, 401)
			case ErrForbidden:
				ctx = render.Status(ctx, 403)
			case ErrNotFound:
				ctx = render.Status(ctx, 404)
			default:
				ctx = render.Status(ctx, 500)
			}
			render.DefaultRespond(ctx, w, map[string]string{"error": err.Error()})
			return
		}

		render.DefaultRespond(ctx, w, v)
	}

	r.Get("/", objectHandler)
	r.Get("/v2", render.UsePresenter(v2), objectHandler)
	r.Get("/v1", render.UsePresenter(v1), objectHandler)

	r.Get("/error", randomErrorHandler)

	http.ListenAndServe(":3333", r)
}

func objectHandler(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	obj := &RuntimeObject{
		ID:       1,
		AuthData: "secret data for auth'd users only",
		Data:     []string{"one", "two", "three", "four"},
	}

	// Simulate some context values (copy over from query params).
	if r.URL.Query().Get("auth") != "" {
		ctx = context.WithValue(ctx, "auth", true)
	}
	if r.URL.Query().Get("error") != "" {
		render.Respond(ctx, w, errors.New("error"))
		return
	}

	render.Respond(ctx, w, obj)
}

func randomErrorHandler(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	errors := []error{ErrUnauthorized, ErrForbidden, ErrNotFound}

	rand.Seed(time.Now().Unix())
	render.Respond(ctx, w, errors[rand.Intn(len(errors))])
}
