package articles

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/pressly/chi"
	"github.com/pressly/chi/render"

	"github.com/pressly/chi/_examples/versions/data"
)

// List all articles.
func listArticles(w http.ResponseWriter, r *http.Request) {
	articles := make(chan *data.Article, 5)

	// Load data asynchronously into the channel (simulate slow storage):
	go func() {
		for i := 1; i <= 10; i++ {
			articles <- &data.Article{
				ID:    i,
				Title: fmt.Sprintf("Article #%v", i),
				Data:  []string{"one", "two", "three", "four"},
				CustomDataForAuthUsers: "secret data for auth'd users only",
			}
			time.Sleep(100 * time.Millisecond)
		}
		close(articles)
	}()

	// Start streaming data from the channel.
	render.Respond(w, r, articles)
}

// Get a single article.
func getArticle(w http.ResponseWriter, r *http.Request) {
	// Load article.
	if chi.URLParam(r, "articleID") != "1" {
		render.Respond(w, r, data.ErrNotFound)
		return
	}
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
