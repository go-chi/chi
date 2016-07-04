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

// Article is runtime object, not meant to be sent via REST.
type Article struct {
	ID                     int      `db:"id" json:"id" xml:"id"`
	Title                  string   `db:"title" json:"title" xml:"title"`
	Data                   []string `db:"data,stringarray" json:"data" xml:"data"`
	CustomDataForAuthUsers string   `db:"custom_data" json:"-" xml:"-"`
}

// ArticleAPI is Article object presented in latest API version for REST response.
type ArticleAPI struct {
	*Article `json:",inline" xml:",inline"`

	// Additional fields.
	URL        string `json:"url" xml:"url"`
	ViewsCount int64  `json:"views_count" xml:"views_count"`

	// Omitted fields.
	// Show custom_data explicitly for auth'd users only.
	CustomDataForAuthUsers interface{} `json:"custom_data,omitempty" xml:"custom_data,omitempty"`
}

// ArticleAPIv2 is Article presented in API version 2 for REST response.
type ArticleAPIv2 struct {
	*ArticleAPI `json:",inline" xml:",inline"`

	// Additional fields.
	SelfURL string `json:"self_url" xml:"self_url"`

	// Omitted fields.
	URL interface{} `json:"url,omitempty" xml:"url,omitempty"`
}

// ArticleAPIv1 is Article presented in API version 1 for REST response.
type ArticleAPIv1 struct {
	*ArticleAPIv2 `json:",inline" xml:",inline"`

	Data map[string]bool `json:"data" xml:"data"`
}

var (
	ErrUnauthorized = errors.New("Unauthorized")
	ErrForbidden    = errors.New("Forbidden")
	ErrNotFound     = errors.New("Resource not found")

	API   = render.NewPresenter()
	APIv2 = render.NewPresenter()
	APIv1 = render.NewPresenter()
)

func init() {
	render.Respond = customRespond

	API = render.DefaultPresenter
	API.Register(func(ctx context.Context, from *Article) (*ArticleAPI, error) {
		rand.Seed(time.Now().Unix())
		to := &ArticleAPI{
			Article:    from,
			ViewsCount: rand.Int63n(100000),
			URL:        fmt.Sprintf("http://localhost:3333/?id=%v", from.ID),
		}
		// Only show to auth'd user.
		if _, ok := ctx.Value("auth").(bool); ok {
			to.CustomDataForAuthUsers = from.CustomDataForAuthUsers
		}
		return to, nil
	})

	APIv2.RegisterFrom(API)
	APIv2.Register(func(ctx context.Context, from *ArticleAPI) (*ArticleAPIv2, error) {
		return &ArticleAPIv2{
			ArticleAPI: from,
			SelfURL:    fmt.Sprintf("http://localhost:3333/v2?id=%v", from.ID),
		}, nil
	})

	APIv1.RegisterFrom(APIv2)
	APIv1.Register(func(ctx context.Context, from *ArticleAPIv2) (*ArticleAPIv1, error) {
		to := &ArticleAPIv1{
			ArticleAPIv2: from,
			Data:         map[string]bool{},
		}
		to.SelfURL = fmt.Sprintf("http://localhost:3333/v1?id=%v", from.ID)
		for _, item := range from.Data {
			to.Data[item] = true
		}
		return to, nil
	})
}

func main() {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(render.ParseContentType)

	r.Get("/", getArticle)                               // API latest version by default.
	r.Get("/v2", render.UsePresenter(APIv2), getArticle) // API version 2.
	r.Get("/v1", render.UsePresenter(APIv1), getArticle) // API version 1.

	r.Get("/error", randomErrorHandler)

	http.ListenAndServe(":3333", r)
}

func getArticle(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	article := &Article{
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
	errors := []error{ErrUnauthorized, ErrForbidden, ErrNotFound}

	rand.Seed(time.Now().Unix())
	render.Respond(ctx, w, errors[rand.Intn(len(errors))])
}

// customRespond sets response status code based on Error value/type.
func customRespond(ctx context.Context, w http.ResponseWriter, v interface{}) {
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
