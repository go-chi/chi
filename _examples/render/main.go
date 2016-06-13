package main

import (
	"errors"
	"fmt"
	"net/http"
	"reflect"

	"golang.org/x/net/context"

	"github.com/pressly/chi"
	"github.com/pressly/chi/middleware"
	"github.com/pressly/chi/render"
	"github.com/pressly/chi/render/converter"
)

type RuntimeObject struct {
	ID          int      `json:"id"`
	PrivateData string   `json:"private_data"`
	Data        []string `json:"data"`
}

type PresenterObject struct {
	*RuntimeObject `json:",inline"`

	URL   string `json:"url"`
	False bool   `json:"false"`

	// Omit by default. Show explicitly for auth'd users.
	PrivateData interface{} `json:"private_data,omitempty"`
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

func main() {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(render.ParseContentType)

	latest := converter.New()
	latest.Register(func(ctx context.Context, from *RuntimeObject) (*PresenterObject, error) {
		to := &PresenterObject{
			RuntimeObject: from,
			URL:           fmt.Sprintf("https://api.example.com/objects/%v", from.ID),
		}
		// Only show to auth'd user.
		if _, ok := ctx.Value("session.user").(bool); ok {
			to.PrivateData = from.PrivateData
		}
		return to, nil
	})

	v2 := converter.New()
	v2.Register(func(ctx context.Context, from *PresenterObject) (*PresenterObjectV2, error) {
		return &PresenterObjectV2{PresenterObject: from, ResourceURL: from.URL}, nil
	})

	v1 := converter.New()
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
	v1.Copy(v2)

	render.Respond = func(ctx context.Context, w http.ResponseWriter, v interface{}) {
		val := reflect.ValueOf(v)
		if err, ok := val.Interface().(error); ok {
			//if err.(HasStatus)
			render.DefaultRespond(render.Status(ctx, 500), w, map[string]string{"error": err.Error()})
			return
		}

		v = latest.Convert(ctx, v)
		version, _ := ctx.Value("version").(string)
		switch version {
		case "", "latest":
			v = latest.Convert(ctx, v)
		case "v2":
			v = v2.Convert(ctx, v)
		case "v1":
			v = v1.Convert(ctx, v)
		default:
			render.DefaultRespond(render.Status(ctx, 422), w, map[string]string{"error": "unknown version"})
			return
		}

		render.DefaultRespond(ctx, w, v)
	}

	r.Get("/", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		obj := &RuntimeObject{
			ID:          1,
			PrivateData: "PrivateData",
			Data:        []string{"one", "two", "three", "four"},
		}

		// Pass version, auth and error query params to ctx to simulate context.
		ctx = context.WithValue(ctx, "version", r.URL.Query().Get("version"))
		if r.URL.Query().Get("auth") != "" {
			ctx = context.WithValue(ctx, "session.user", true)
		}
		if r.URL.Query().Get("error") != "" {
			render.Respond(ctx, w, errors.New("error"))
			return
		}

		render.Respond(ctx, w, obj)
	})

	http.ListenAndServe(":3333", r)
}
