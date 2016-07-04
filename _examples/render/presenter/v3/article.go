package v3

import (
	"context"
	"fmt"
	"math/rand"
	"time"

	"github.com/pressly/chi/_examples/render/data"
	"github.com/pressly/chi/render"
)

// Article presented in API version 2.
type Article struct {
	*data.Article `json:",inline" xml:",inline"`

	// Additional fields.
	URL        string `json:"url" xml:"url"`
	ViewsCount int64  `json:"views_count" xml:"views_count"`
	Version    string `json:"version" xml:"version"`

	// Omitted fields.
	// Show custom_data explicitly for auth'd users only.
	CustomDataForAuthUsers interface{} `json:"custom_data,omitempty" xml:"custom_data,omitempty"`
}

var Presenter = render.NewPresenter(ArticleV3)

func ArticleV3(ctx context.Context, from *data.Article) (*Article, error) {
	rand.Seed(time.Now().Unix())
	to := &Article{
		Article:    from,
		ViewsCount: rand.Int63n(100000),
		URL:        fmt.Sprintf("http://localhost:3333/v3/?id=%v", from.ID),
		Version:    "v3",
	}
	// Only show to auth'd user.
	if _, ok := ctx.Value("auth").(bool); ok {
		to.CustomDataForAuthUsers = from.CustomDataForAuthUsers
	}
	return to, nil
}
