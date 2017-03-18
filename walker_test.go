package chi

import (
	"net/http"
	"testing"
)

func TestWalker(t *testing.T) {
	r := MuxBig()

	// Walk the router tree.
	if err := Walk(r, func(method string, route string, handler http.Handler, middlewares ...func(http.Handler) http.Handler) error {
		return nil
	}); err != nil {
		t.Error(err)
	}
}
