package docgen_test

import (
	"context"
	"fmt"
	"net/http"
	"testing"

	"github.com/go-chi/chi"
	"github.com/go-chi/chi/docgen"
)

// RequestID comment goes here.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := context.WithValue(r.Context(), "requestID", "1")
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func hubIndexHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	s := fmt.Sprintf("/hubs/%s reqid:%s session:%s",
		chi.URLParam(r, "hubID"), ctx.Value("requestID"), ctx.Value("session.user"))
	w.Write([]byte(s))
}

// Generate docs for the MuxBig from chi/mux_test.go
func TestMuxBig(t *testing.T) {
	var r, sr1, sr2, sr3, sr4, sr5, sr6 *chi.Mux
	r = chi.NewRouter()
	r.Use(RequestID)

	// Some inline middleware, 1
	// We just love Go's ast tools
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r)
		})
	})
	r.Group(func(r chi.Router) {
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				ctx := context.WithValue(r.Context(), "session.user", "anonymous")
				next.ServeHTTP(w, r.WithContext(ctx))
			})
		})
		r.Get("/favicon.ico", func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte("fav"))
		})
		r.Get("/hubs/{hubID}/view", func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()
			s := fmt.Sprintf("/hubs/%s/view reqid:%s session:%s", chi.URLParam(r, "hubID"),
				ctx.Value("requestID"), ctx.Value("session.user"))
			w.Write([]byte(s))
		})
		r.Get("/hubs/{hubID}/view/*", func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()
			s := fmt.Sprintf("/hubs/%s/view/%s reqid:%s session:%s", chi.URLParamFromCtx(ctx, "hubID"),
				chi.URLParam(r, "*"), ctx.Value("requestID"), ctx.Value("session.user"))
			w.Write([]byte(s))
		})
	})
	r.Group(func(r chi.Router) {
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				ctx := context.WithValue(r.Context(), "session.user", "elvis")
				next.ServeHTTP(w, r.WithContext(ctx))
			})
		})
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()
			s := fmt.Sprintf("/ reqid:%s session:%s", ctx.Value("requestID"), ctx.Value("session.user"))
			w.Write([]byte(s))
		})
		r.Get("/suggestions", func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()
			s := fmt.Sprintf("/suggestions reqid:%s session:%s", ctx.Value("requestID"), ctx.Value("session.user"))
			w.Write([]byte(s))
		})

		r.Get("/woot/{wootID}/*", func(w http.ResponseWriter, r *http.Request) {
			s := fmt.Sprintf("/woot/%s/%s", chi.URLParam(r, "wootID"), chi.URLParam(r, "*"))
			w.Write([]byte(s))
		})

		r.Route("/hubs", func(r chi.Router) {
			sr1 = r.(*chi.Mux)
			r.Use(func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					next.ServeHTTP(w, r)
				})
			})
			r.Route("/{hubID}", func(r chi.Router) {
				sr2 = r.(*chi.Mux)
				r.Get("/", hubIndexHandler)
				r.Get("/touch", func(w http.ResponseWriter, r *http.Request) {
					ctx := r.Context()
					s := fmt.Sprintf("/hubs/%s/touch reqid:%s session:%s", chi.URLParam(r, "hubID"),
						ctx.Value("requestID"), ctx.Value("session.user"))
					w.Write([]byte(s))
				})

				sr3 = chi.NewRouter()
				sr3.Get("/", func(w http.ResponseWriter, r *http.Request) {
					ctx := r.Context()
					s := fmt.Sprintf("/hubs/%s/webhooks reqid:%s session:%s", chi.URLParam(r, "hubID"),
						ctx.Value("requestID"), ctx.Value("session.user"))
					w.Write([]byte(s))
				})
				sr3.Route("/{webhookID}", func(r chi.Router) {
					sr4 = r.(*chi.Mux)
					r.Get("/", func(w http.ResponseWriter, r *http.Request) {
						ctx := r.Context()
						s := fmt.Sprintf("/hubs/%s/webhooks/%s reqid:%s session:%s", chi.URLParam(r, "hubID"),
							chi.URLParam(r, "webhookID"), ctx.Value("requestID"), ctx.Value("session.user"))
						w.Write([]byte(s))
					})
				})

				// TODO: /webooks is not coming up as a subrouter here...
				// we kind of want to wrap a Router... ?
				// perhaps add .Router() to the middleware inline thing..
				// and use that always.. or, can detect in that method..
				r.Mount("/webhooks", chi.Chain(func(next http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), "hook", true)))
					})
				}).Handler(sr3))

				// HMMMM.. only let Mount() for just a Router..?
				// r.Mount("/webhooks", Use(...).Router(sr3))
				// ... could this work even....?

				// HMMMMMMMMMMMMMMMMMMMMMMMM...
				// even if Mount() were to record all subhandlers mounted, we still couldn't get at the
				// routes

				r.Route("/posts", func(r chi.Router) {
					sr5 = r.(*chi.Mux)
					r.Get("/", func(w http.ResponseWriter, r *http.Request) {
						ctx := r.Context()
						s := fmt.Sprintf("/hubs/%s/posts reqid:%s session:%s", chi.URLParam(r, "hubID"),
							ctx.Value("requestID"), ctx.Value("session.user"))
						w.Write([]byte(s))
					})
				})
			})
		})

		r.Route("/folders/", func(r chi.Router) {
			sr6 = r.(*chi.Mux)
			r.Get("/", func(w http.ResponseWriter, r *http.Request) {
				ctx := r.Context()
				s := fmt.Sprintf("/folders/ reqid:%s session:%s",
					ctx.Value("requestID"), ctx.Value("session.user"))
				w.Write([]byte(s))
			})
			r.Get("/public", func(w http.ResponseWriter, r *http.Request) {
				ctx := r.Context()
				s := fmt.Sprintf("/folders/public reqid:%s session:%s",
					ctx.Value("requestID"), ctx.Value("session.user"))
				w.Write([]byte(s))
			})
			r.Get("/in", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}).ServeHTTP)

			r.With(func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), "search", true)))
				})
			}).Get("/search", func(w http.ResponseWriter, r *http.Request) {
				w.Write([]byte("searching.."))
			})
		})
	})

	fmt.Println(docgen.JSONRoutesDoc(r))

	// docgen.PrintRoutes(r)

}
