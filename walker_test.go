package chi

import (
	"net/http"
	"testing"
)

func TestWalker(t *testing.T) {
	r := muxBig()

	// Walk the muxBig router tree.
	if err := Walk(r, func(method string, route string, handler http.Handler, middlewares ...func(http.Handler) http.Handler) error {
		t.Logf("%v %v", method, route)

		return nil
	}); err != nil {
		t.Error(err)
	}
}
