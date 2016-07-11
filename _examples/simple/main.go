package main

import (
	"context"
	"fmt"
	"net/http"

	"github.com/pressly/chi"
	"github.com/pressly/chi/middleware"
)

func main() {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Use(func(h http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := context.WithValue(r.Context(), "example", true)
			h.ServeHTTP(w, r.WithContext(ctx))
		})
	})

	r.Get("/", apiIndex)

	r.Mount("/accounts", accountsRouter())

	http.ListenAndServe(":3333", r)
}

func accountsRouter() chi.Router {
	r := chi.NewRouter()

	r.Use(sup1)

	r.Get("/", listAccounts)
	r.Post("/", createAccount)
	r.Get("/hi", hiAccounts)

	r.Group(func(r chi.Router) {
		r.Use(sup2)

		r.Get("/hi2", func(w http.ResponseWriter, r *http.Request) {
			v := r.Context().Value("sup2").(string)
			w.Write([]byte(fmt.Sprintf("hi2 - '%s'", v)))
		})
		r.Get("/ahh", func(w http.ResponseWriter, r *http.Request) {
			v := r.Context().Value("sup2").(string)
			w.Write([]byte(fmt.Sprintf("ahh - '%s'", v)))
		})
		r.Get("/fail", func(w http.ResponseWriter, r *http.Request) {
			panic("no..")
		})
	})

	r.Route("/:accountID", func(r chi.Router) {
		r.Use(accountCtx)
		r.Get("/", getAccount)
		r.Put("/", updateAccount)
		r.Get("/*", other)
	})

	return r
}

func sup1(next http.Handler) http.Handler {
	hfn := func(w http.ResponseWriter, r *http.Request) {
		ctx := context.WithValue(r.Context(), "sup1", "sup1")
		next.ServeHTTP(w, r.WithContext(ctx))
	}
	return http.HandlerFunc(hfn)
}

func sup2(next http.Handler) http.Handler {
	hfn := func(w http.ResponseWriter, r *http.Request) {
		ctx := context.WithValue(r.Context(), "sup2", "sup2")
		next.ServeHTTP(w, r.WithContext(ctx))
	}
	return http.HandlerFunc(hfn)
}

func accountCtx(h http.Handler) http.Handler {
	handler := func(w http.ResponseWriter, r *http.Request) {
		ctx := context.WithValue(r.Context(), "account", "account 123")
		h.ServeHTTP(w, r.WithContext(ctx))
	}
	return http.HandlerFunc(handler)
}

func apiIndex(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("root"))
}

func listAccounts(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("list accounts"))
}

func hiAccounts(w http.ResponseWriter, r *http.Request) {
	sup1 := r.Context().Value("sup1").(string)
	w.Write([]byte(fmt.Sprintf("hi accounts %v", sup1)))
}

func createAccount(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("create account"))
}

func getAccount(w http.ResponseWriter, r *http.Request) {
	accountID := chi.URLParam(r, "accountID")
	account := r.Context().Value("account").(string)
	w.Write([]byte(fmt.Sprintf("get account id:%s details:%s", accountID, account)))
}

func updateAccount(w http.ResponseWriter, r *http.Request) {
	account := r.Context().Value("account").(string)
	w.Write([]byte(fmt.Sprintf("update account:%s", account)))
}

func other(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("catch all.."))
}
