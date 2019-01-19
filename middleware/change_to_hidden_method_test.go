package middleware

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/go-chi/chi"
)

func TestChangePostToHiddenMethod(t *testing.T) {
	r := chi.NewRouter()
	r.Use(ChangePostToHiddenMethod)
	r.Post("/post", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("post"))
	})
	r.Put("/put", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("put"))
	})
	r.Delete("/delete", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("delete"))
	})

	tests := []struct {
		method             string
		path               string
		body               url.Values
		expectedStatusCode int
		expectedBody       string
	}{
		{
			http.MethodPost,
			"/post",
			url.Values{},
			http.StatusOK,
			"post",
		},
		{
			http.MethodPut,
			"/put",
			url.Values{
				"_method": {"PUT"},
			},
			http.StatusOK,
			"put",
		},
		{
			http.MethodDelete,
			"/delete",
			url.Values{
				"_method": {"DELETE"},
			},
			http.StatusOK,
			"delete",
		},
	}

	ts := httptest.NewServer(r)
	defer ts.Close()
	for _, test := range tests {
		resp, body := testRequest(t, ts, test.method, test.path, nil)
		if resp.StatusCode != test.expectedStatusCode {
			t.Errorf("unexpected status code: got %d, but expected %d\n", resp.StatusCode, test.expectedStatusCode)
		}
		if body != test.expectedBody {
			t.Errorf("unexpected body: got %s, but expected %s\n", body, test.expectedBody)
		}
	}
}
