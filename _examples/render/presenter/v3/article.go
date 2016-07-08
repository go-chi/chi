package v3

import (
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"reflect"
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
	APIVersion string `json:"api_version" xml:"api_version"`

	// Omitted fields.
	// Show custom_data explicitly for auth'd users only.
	CustomDataForAuthUsers interface{} `json:"custom_data,omitempty" xml:"custom_data,omitempty"`
}

var Presenter = render.NewPresenter(CatchAll, ArticleToV3, ArticleChanToV3Chan, ArticleSliceToV3Slice)

func ArticleToV3(r *http.Request, from *data.Article) (*Article, error) {
	log.Printf("item presenter!")

	rand.Seed(time.Now().Unix())
	to := &Article{
		Article:    from,
		ViewsCount: rand.Int63n(100000),
		URL:        fmt.Sprintf("http://localhost:3333/v3/?id=%v", from.ID),
		APIVersion: "v3",
	}
	// Only show to auth'd user.
	if _, ok := r.Context().Value("auth").(bool); ok {
		to.CustomDataForAuthUsers = from.CustomDataForAuthUsers
	}
	return to, nil
}

// An optional, optimized presenter for channnel of Articles.
// If not defined, each item will be preseted using ArticleToV3() func.
func ArticleChanToV3Chan(r *http.Request, fromChan chan *data.Article) (chan *Article, error) {
	log.Printf("channel presenter!")

	rand.Seed(time.Now().Unix())

	toChan := make(chan *Article, 5)
	go func() {
		for from := range fromChan {
			to := &Article{
				Article:    from,
				ViewsCount: rand.Int63n(100000),
				URL:        fmt.Sprintf("http://localhost:3333/v3/?id=%v", from.ID),
				APIVersion: "v3",
			}
			// Only show to auth'd user.
			if _, ok := r.Context().Value("auth").(bool); ok {
				to.CustomDataForAuthUsers = from.CustomDataForAuthUsers
			}

			toChan <- to
		}
		close(toChan)
	}()

	return toChan, nil
}

// An optional, optimized presenter for slice of Articles.
// If not defined, each item will be preseted using ArticleToV3() func.
func ArticleSliceToV3Slice(r *http.Request, fromSlice []*data.Article) ([]*Article, error) {
	log.Printf("slice presenter!")

	rand.Seed(time.Now().Unix())

	toSlice := make([]*Article, len(fromSlice))
	for i, from := range fromSlice {
		to := &Article{
			Article:    from,
			ViewsCount: rand.Int63n(100000),
			URL:        fmt.Sprintf("http://localhost:3333/v3/?id=%v", from.ID),
			APIVersion: "v3",
		}
		// Only show to auth'd user.
		if _, ok := r.Context().Value("auth").(bool); ok {
			to.CustomDataForAuthUsers = from.CustomDataForAuthUsers
		}
		toSlice[i] = to
	}

	return toSlice, nil
}

func CatchAll(r *http.Request, v interface{}) (*http.Request, interface{}) {
	if val := reflect.ValueOf(v); val.IsValid() {
		if err, ok := val.Interface().(error); ok {
			return data.PresentError(r, err)
		}
	}
	return r, v
}
