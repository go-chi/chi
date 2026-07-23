package chi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// Named catch-all {name:*} (issue #1106) matches the remainder of the path
// under a user-chosen param key instead of "*".
func TestNamedCatchAllParam(t *testing.T) {
	r := NewRouter()
	r.Get("/files/{path:*}", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(URLParam(r, "path")))
	})
	r.Get("/assets/{id}/{rest:*}", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(URLParam(r, "id") + "|" + URLParam(r, "rest")))
	})
	// Existing bare * still works and records key "*".
	r.Get("/legacy/*", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(URLParam(r, "*")))
	})

	tests := []struct {
		path string
		want string
	}{
		{"/files/", ""},
		{"/files/a", "a"},
		{"/files/a/b/c", "a/b/c"},
		{"/files/foo/bar.txt", "foo/bar.txt"},
		{"/assets/9/x/y", "9|x/y"},
		{"/legacy/z/w", "z/w"},
	}
	for _, tc := range tests {
		req := httptest.NewRequest(http.MethodGet, tc.path, nil)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status %d", tc.path, rec.Code)
		}
		if got := rec.Body.String(); got != tc.want {
			t.Fatalf("%s: got %q want %q", tc.path, got, tc.want)
		}
	}
}

func TestNamedCatchAllMustBeLast(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic for trailing text after named catch-all")
		}
	}()
	r := NewRouter()
	r.Get("/files/{path:*}/edit", func(w http.ResponseWriter, r *http.Request) {})
}

func TestPatNextSegmentNamedCatchAll(t *testing.T) {
	nt, key, rex, _, _, _ := patNextSegment("/files/{path:*}")
	if nt != ntCatchAll || key != "path" || rex != "" {
		t.Fatalf("got typ=%v key=%q rex=%q", nt, key, rex)
	}
	keys := patParamKeys("/files/{path:*}")
	if len(keys) != 1 || keys[0] != "path" {
		t.Fatalf("keys=%v", keys)
	}
	keys = patParamKeys("/a/{id}/{rest:*}")
	if len(keys) != 2 || keys[0] != "id" || keys[1] != "rest" {
		t.Fatalf("keys=%v", keys)
	}
}
