package chi

import "testing"

func TestURLParam(t *testing.T) {
	t.Run("should return corresponding value if key exists", func(t *testing.T) {
		ctx := NewRouteContext()
		ctx.URLParams.Add("key1", "value1")
		ctx.URLParams.Add("key2", "value2")

		t.Run("should return corresponding value given the first key", func(t *testing.T) {
			got := ctx.URLParam("key1")
			expect := "value1"
			if got != expect {
				t.Errorf("got %v, expected %v", got, expect)
			}
		})

		t.Run("should return corresponding value given the last key", func(t *testing.T) {
			got := ctx.URLParam("key2")
			expect := "value2"
			if got != expect {
				t.Errorf("got %v, expected %v", got, expect)
			}
		})
	})

	t.Run("should return empty string if key does not exist", func(t *testing.T) {
		ctx := NewRouteContext()
		ctx.URLParams.Add("key1", "value1")
		ctx.URLParams.Add("key2", "value2")

		got := ctx.URLParam("key3")
		expect := ""
		if got != expect {
			t.Errorf("got %v, expected %v", got, expect)
		}
	})

	t.Run("should return empty string if value is out of range", func(t *testing.T) {
		ctx := NewRouteContext()
		ctx.URLParams.Keys = append(ctx.URLParams.Keys, "key1")

		got := ctx.URLParam("key1")
		expect := ""
		if got != expect {
			t.Errorf("got %v, expected %v", got, expect)
		}
	})
}
