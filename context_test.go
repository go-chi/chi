package chi

import (
	"context"
	"net/http"
	"testing"
)

func TestContextURLParam(t *testing.T) {
	rctx := NewRouteContext()
	rctx.URLParams.Add("id", "123")

	t.Run("ID Exists", func(t *testing.T) {
		if rctx.URLParam("id") != "123" {
			t.Fail()
		}
	})
	t.Run("NotID Doesn't Exist", func(t *testing.T) {
		if rctx.URLParam("not_id") != "" {
			t.Fail()
		}
	})
}

func TestContextKeyString(t *testing.T) {
	t.Run("RouteCtxKey", func(t *testing.T) {
		if RouteCtxKey.String() != "chi context value RouteContext" {
			t.Fail()
		}
	})
}

func TestURLParam(t *testing.T) {
	rctx := NewRouteContext()
	rctx.URLParams.Add("id", "123")

	ctx := context.WithValue(context.Background(), RouteCtxKey, rctx)

	req, _ := http.NewRequest("GET", "/123", nil)
	creq := req.WithContext(ctx)

	t.Run("from request", func(t *testing.T) {
		expected := "123"
		if URLParam(creq, "id") != expected {
			t.Fatalf("expected:%s got:%s", expected, URLParam(req, "id"))
		}
	})

	t.Run("from request with invalid param key", func(t *testing.T) {
		if URLParam(creq, "not_id") != "" {
			t.Fatal("expected empty string")
		}
	})

	t.Run("from request with no request", func(t *testing.T) {
		if URLParam(req, "") != "" {
			t.Fatal("expected empty string")
		}
	})

	t.Run("from context", func(t *testing.T) {
		expected := "123"
		if URLParamFromCtx(ctx, "id") != expected {
			t.Fatalf("expected:%s got:%s", expected, URLParam(req, "id"))
		}
	})

	t.Run("from context with invalid param key", func(t *testing.T) {
		if URLParamFromCtx(ctx, "not_id") != "" {
			t.Fatal("expected empty string")
		}
	})

	t.Run("from context with no route context", func(t *testing.T) {
		if URLParamFromCtx(context.Background(), "") != "" {
			t.Fatal("expected empty string")
		}
	})
}
