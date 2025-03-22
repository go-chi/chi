package middleware

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func RouteHeadersDenyTestMiddleware() func(http.Handler) http.Handler {
	return func(_ http.Handler) http.Handler {
		return http.HandlerFunc(func(wrt http.ResponseWriter, _ *http.Request) {
			wrt.WriteHeader(http.StatusForbidden)
		})
	}
}

func TestRouteHeadersMiddleware(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		header         string
		match          string
		matchType      MatcherType
		requestHeaders map[string]string
		want           int
	}{
		{
			"TestClassicMatch",
			"Authorization",
			"Bearer *",
			RouteHeadersClassicMatcher,
			map[string]string{
				"Authorization": "Bearer whatever",
				"Other":         "bera",
			},
			http.StatusForbidden,
		},
		{
			"TestContainsMatch",
			"Cookie",
			"kc-access=",
			RouteHeadersContainsMatcher,
			map[string]string{
				"Cookie": "some-cookie=tadadada; kc-access=mytoken",
			},
			http.StatusForbidden,
		},
		{
			"TestRegexMatch",
			"X-Custom-Header",
			".*mycustom[4-9]+.*",
			RouteHeadersRegexMatcher,
			map[string]string{
				"X-Custom-Header": "test1mycustom564other",
			},
			http.StatusForbidden,
		},
		{
			"TestMatchAndValueIsLowered",
			"Authorization",
			"Bearer *",
			RouteHeadersClassicMatcher,
			map[string]string{
				"Authorization": "bearer whatever",
			},
			http.StatusForbidden,
		},
		{
			"TestNotMatch",
			"Authorization",
			"Bearer *",
			RouteHeadersClassicMatcher,
			map[string]string{
				"Authorization": "Basic test",
			},
			http.StatusOK,
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			recorder := httptest.NewRecorder()

			headerRouterMiddleware := RouteHeaders().
				SetMatchingType(test.matchType).
				Route(
					test.header,
					test.match,
					RouteHeadersDenyTestMiddleware(),
				).
				Handler

			router := chi.NewRouter()
			router.Use(headerRouterMiddleware)
			router.Get("/", func(_ http.ResponseWriter, _ *http.Request) {})

			var body []byte
			req := httptest.NewRequest(http.MethodGet, "/", bytes.NewReader(body))
			for hName, hVal := range test.requestHeaders {
				req.Header.Set(hName, hVal)
			}

			router.ServeHTTP(recorder, req)
			res := recorder.Result()

			res.Body.Close()

			if res.StatusCode != test.want {
				t.Errorf("response is incorrect, got %d, want %d", recorder.Code, test.want)
			}
		})
	}
}
