package main

import (
	"fmt"
	"log"
	"net/http"

	"github.com/pressly/chi"
	"golang.org/x/net/context"
)

func main() {
	r := chi.NewRouter()

	// r.Use(middleware.RequestID)
	// r.Use(middleware.RealIP)

	r.Use(func(h chi.Handler) chi.Handler {
		return chi.HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
			log.Println("~~ root middleware..")
			h.ServeHTTPC(ctx, w, r)
		})
	})

	r.Get("/", apiIndex)

	r.Mount("/accounts", sup, accountsRouter())

	http.ListenAndServe(":3333", r)
}

func apiIndex(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("root"))
}

//--

func accountsRouter() chi.Router {
	r := chi.NewRouter()
	r.Use(sup1)
	r.Get("/", listAccounts)
	r.Get("/hi", hiAccounts)

	r.Post("/", createAccount)

	r.Group(func(r chi.Router) {
		r.Use(sup2)

		r.Get("/hi2", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
			log.Println("hi2..", ctx.Value("sup2"))
			w.Write([]byte("woot"))
		})
	})

	// 2nd param is optional..
	r.Route("/:accountID", func(r chi.Router) {
		r.Use(accountCtx)
		r.Get("/", getAccount)
		r.Post("/", updateAccount)
		r.Get("/*", other)
	})

	return r
}

func sup1(h chi.Handler) chi.Handler {
	handler := func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		log.Println("sup1..")
		// c.Env["sup1"] = "sup1"
		ctx = context.WithValue(ctx, "sup1", "sup1")
		h.ServeHTTPC(ctx, w, r)
	}
	return chi.HandlerFunc(handler)
}

func sup2(h chi.Handler) chi.Handler {
	handler := func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		log.Println("sup2..")
		// c.Env["sup2"] = "sup2"
		ctx = context.WithValue(ctx, "sup2", "sup2")
		h.ServeHTTPC(ctx, w, r)
	}
	return chi.HandlerFunc(handler)
}

func sup(h http.Handler) http.Handler {
	handler := func(w http.ResponseWriter, r *http.Request) {
		log.Println("sup here..")
		h.ServeHTTP(w, r)
	}
	return http.HandlerFunc(handler)
}

func accountCtx(h chi.Handler) chi.Handler {
	handler := func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		log.Println("accountCtx......", ctx)
		// c.Env["account"] = "account 123"
		ctx = context.WithValue(ctx, "account", "account 123")
		h.ServeHTTPC(ctx, w, r)
	}
	return chi.HandlerFunc(handler)
}

func listAccounts(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	log.Println("list accounts")
	w.Write([]byte("list accounts"))
}

func hiAccounts(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	log.Println("hi accounts", ctx.Value("sup1"))
	w.Write([]byte("hi accounts"))
}

func createAccount(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("create account"))
}

func getAccount(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	log.Println("getAccount..")
	w.Write([]byte(fmt.Sprintf("get account --> %v %v", ctx.Value("account"), chi.URLParams(ctx)["accountID"])))
}

func updateAccount(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	log.Println("updateAccount..")
	w.Write([]byte(fmt.Sprintf("update account --> %v %v", ctx.Value("account"), chi.URLParams(ctx)["accountID"])))
}

func other(w http.ResponseWriter, r *http.Request) {
	log.Println("other..")
	w.Write([]byte("."))
}
