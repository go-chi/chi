package middleware

import "net/http"

func ChangePostToHiddenMethod(next http.Handler) http.Handler {
	var changeableMethods = map[string]bool{
		http.MethodPut:    true,
		http.MethodDelete: true,
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			next.ServeHTTP(w, r)
			return
		}

		method := r.FormValue("_method")
		if ok := changeableMethods[method]; ok {
			r.Method = method
		}

		next.ServeHTTP(w, r)
	})
}
