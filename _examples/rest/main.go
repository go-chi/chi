package main

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"math/rand"
	"net/http"
	"time"

	"github.com/pressly/chi"
	"github.com/pressly/chi/middleware"
	"golang.org/x/net/context"
)

func main() {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("..."))
	})

	r.Get("/ping", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("pong"))
	})

	r.Get("/panic", func(w http.ResponseWriter, r *http.Request) {
		panic("test")
	})

	// Slow handlers/operations.
	r.Group(func(r chi.Router) {
		// Stop processing when client disconnects.
		r.Use(middleware.CloseNotify)

		// Stop processing after 2.5 seconds.
		r.Use(middleware.Timeout(2500 * time.Millisecond))

		r.Get("/slow", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
			rand.Seed(time.Now().Unix())

			// Processing will take 1-5 seconds.
			processTime := time.Duration(rand.Intn(4)+1) * time.Second

			select {
			case <-ctx.Done():
				return

			case <-time.After(processTime):
				// The above channel simulates some hard work.
			}

			w.Write([]byte(fmt.Sprintf("Processed in %v seconds\n", processTime)))
		})
	})

	// Throttle very expensive handlers/operations.
	r.Group(func(r chi.Router) {
		// Stop processing after 30 seconds.
		r.Use(middleware.Timeout(30 * time.Second))

		// Only one request will be processed at a time.
		r.Use(middleware.Throttle(1))

		r.Get("/throttled", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
			select {
			case <-ctx.Done():
				switch ctx.Err() {
				case context.DeadlineExceeded:
					w.WriteHeader(504)
					w.Write([]byte("Processing too slow\n"))
				default:
					w.Write([]byte("Canceled\n"))
				}
				return

			case <-time.After(5 * time.Second):
				// The above channel simulates some hard work.
			}

			w.Write([]byte("Processed\n"))
		})
	})

	// RESTy routes for "articles" resource
	r.Route("/articles", func(r chi.Router) {
		r.Get("/", paginate, listArticles) // GET /articles
		r.Post("/", createArticle)         // POST /articles

		r.Route("/:articleID", func(r chi.Router) {
			r.Use(ArticleCtx)
			r.Get("/", getArticle)       // GET /articles/123
			r.Put("/", updateArticle)    // PUT /articles/123
			r.Delete("/", deleteArticle) // DELETE /article/123
		})
	})

	// Mount the admin sub-router
	r.Mount("/admin", adminRouter())

	http.ListenAndServe(":3333", r)
}

type Article struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

func ArticleCtx(next chi.Handler) chi.Handler {
	return chi.HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		articleID := chi.URLParams(ctx)["articleID"]
		article, err := dbGetArticle(articleID)
		if err != nil {
			http.Error(w, http.StatusText(404), 404)
			return
		}
		ctx = context.WithValue(ctx, "article", article)
		next.ServeHTTPC(ctx, w, r)
	})
}

func listArticles(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("list of articles.."))
}

func createArticle(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	var article *Article

	// btw, you could do this body reading / marhsalling in a nice bind middleware
	data, err := ioutil.ReadAll(r.Body)
	if err != nil {
		http.Error(w, err.Error(), 422)
		return
	}
	defer r.Body.Close()

	if err := json.Unmarshal(data, &article); err != nil {
		http.Error(w, err.Error(), 422)
		return
	}

	// should really send back the json marshalled new article.
	// build your own responder :)
	w.Write([]byte(article.Title))
}

func getArticle(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	article, ok := ctx.Value("article").(*Article)
	if !ok {
		http.Error(w, http.StatusText(422), 422)
		return
	}
	w.Write([]byte(fmt.Sprintf("title:%s", article.Title)))
}

func updateArticle(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	article, ok := ctx.Value("article").(*Article)
	if !ok {
		http.Error(w, http.StatusText(404), 404)
		return
	}

	// btw, you could do this body reading / marhsalling in a nice bind middleware
	data, err := ioutil.ReadAll(r.Body)
	if err != nil {
		http.Error(w, err.Error(), 422)
		return
	}
	defer r.Body.Close()

	uArticle := struct {
		*Article
		_ interface{} `json:"id,omitempty"` // prevents 'id' from being overridden
	}{Article: article}

	if err := json.Unmarshal(data, &uArticle); err != nil {
		http.Error(w, err.Error(), 422)
		return
	}

	// should really send back the json marshalled updated article.
	// build your own responder :)
	w.Write([]byte(fmt.Sprintf("updated article, title:%s", uArticle.Title)))
}

func deleteArticle(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	article, ok := ctx.Value("article").(*Article)
	if !ok {
		http.Error(w, http.StatusText(422), 422)
		return
	}
	_ = article // delete the article from the data store..
	w.WriteHeader(204)
}

func dbGetArticle(id string) (*Article, error) {
	//.. fetch the article from a data store of some kind..
	return &Article{ID: id, Title: "Going all the way,"}, nil
}

func paginate(next chi.Handler) chi.Handler {
	return chi.HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		// just a stub.. some ideas are to look at URL query params for something like
		// the page number, or the limit, and send a query cursor down the chain
		next.ServeHTTPC(ctx, w, r)
	})
}

// A completely separate router for administrator routes
func adminRouter() chi.Router {
	r := chi.NewRouter()
	r.Use(AdminOnly)
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("admin: index"))
	})
	r.Get("/accounts", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("admin: list accounts.."))
	})
	return r
}

func AdminOnly(next chi.Handler) chi.Handler {
	return chi.HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		isAdmin, ok := ctx.Value("acl.admin").(bool)
		if !ok || !isAdmin {
			http.Error(w, http.StatusText(403), 403)
			return
		}
		next.ServeHTTPC(ctx, w, r)
	})
}
