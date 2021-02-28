package v3

import (
	"fmt"
	"math/rand"
	"net/http"

	"github.com/go-chi/chi/v5/_examples/versions/data"
)

// Article presented in API version 2.
type Article struct {
	*data.Article `json:",inline" xml:",inline"`

	// Additional fields.
	URL        string `json:"url" xml:"url"`
	ViewsCount int64  `json:"views_count" xml:"views_count"`
	APIVersion string `json:"api_version" xml:"api_version"`

	// Omitted fields.
	// Show custom_data explicitly for auth'd users only.
	CustomDataForAuthUsers interface{} `json:"custom_data,omitempty" xml:"custom_data,omitempty"`
}

func (a *Article) Render(w http.ResponseWriter, r *http.Request) error {
	a.ViewsCount = rand.Int63n(100000)
	a.URL = fmt.Sprintf("http://localhost:3333/v3/?id=%v", a.ID)

	// Only show to auth'd user.
	if _, ok := r.Context().Value("auth").(bool); ok {
		a.CustomDataForAuthUsers = a.Article.CustomDataForAuthUsers
	}

	return nil
}

func NewArticleResponse(article *data.Article) *Article {
	return &Article{Article: article}
}
