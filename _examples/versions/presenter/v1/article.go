package v1

import (
	"fmt"
	"net/http"

	"github.com/pressly/chi/_examples/versions/presenter/v2"
	"github.com/pressly/chi/render"
)

// Article presented in API version 1.
type Article struct {
	*v2.Article `json:",inline" xml:",inline"`

	Data map[string]bool `json:"data" xml:"data"`
}

var Presenter = render.NewPresenter(ArticleV2ToV1)

func init() {
	Presenter.CopyFrom(v2.Presenter)
}

func ArticleV2ToV1(r *http.Request, from *v2.Article) (*Article, error) {
	to := &Article{
		Article: from,
		Data:    map[string]bool{},
	}
	to.SelfURL = fmt.Sprintf("http://localhost:3333/v1?id=%v", from.ID)
	to.APIVersion = "v1"
	for _, item := range from.Data {
		to.Data[item] = true
	}
	return to, nil
}
