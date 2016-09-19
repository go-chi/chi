package raml_test

import (
	"context"
	"fmt"
	"net/http"
	"testing"

	"github.com/pressly/chi/docgen/raml"
	yaml "gopkg.in/yaml.v2"
)

// requestID middleware comment goes here.
func requestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := context.WithValue(r.Context(), "requestID", "1")
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// hubIndexHandler serves Hub Index page.
func hubIndexHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	s := fmt.Sprintf("/hubs/%s reqid:%s session:%s",
		URLParam(r, "hubID"), ctx.Value("requestID"), ctx.Value("session.user"))
	w.Write([]byte(s))
}

func TestWalkerRAML(t *testing.T) {
	r := chi.MuxBig()

	ramlDocs := &raml.RAML{
		Title:     "Big Mux",
		BaseUri:   "https://bigmux.example.com",
		Version:   "v1.0",
		MediaType: "application/json",
	}

	if err := Walk(r, func(method string, route string, handler http.Handler, middlewares ...func(http.Handler) http.Handler) error {
		info := GetFuncInfo(handler)
		desc := info.Comment
		if desc == "" {
			desc = info.Func
		}

		record := raml.Record{
			Description: desc,
		}
		err := ramlDocs.Add(method, route, record)
		if err != nil {
			return err
		}

		return nil
	}); err != nil {
		t.Error(err)
	}

	b, err := yaml.Marshal(ramlDocs)
	if err != nil {
		t.Error(err)
	}
	fmt.Printf("%s%s", raml.Header, b)
}
