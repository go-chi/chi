# github.com/go-chi/chi

Welcome to the chi/_examples/rest generated docs.

## Routes

<details>
<summary>`/`</summary>

- [RequestID](/middleware/request_id.go#L63)
- [Logger](/middleware/logger.go#L26)
- [Recoverer](/middleware/recoverer.go#L18)
- [URLFormat](/middleware/url_format.go#L45)
- [SetContentType.func1](https://github.com/go-chi/render/content_type.go#L49)
- **/**
	- _GET_
		- [main.main.func1](/_examples/rest/main.go#L69)

</details>
<details>
<summary>`/admin/*`</summary>

- [RequestID](/middleware/request_id.go#L63)
- [Logger](/middleware/logger.go#L26)
- [Recoverer](/middleware/recoverer.go#L18)
- [URLFormat](/middleware/url_format.go#L45)
- [SetContentType.func1](https://github.com/go-chi/render/content_type.go#L49)
- **/admin/***
	- [main.AdminOnly](/_examples/rest/main.go#L238)
	- **/**
		- _GET_
			- [main.adminRouter.func1](/_examples/rest/main.go#L225)

</details>
<details>
<summary>`/admin/*/accounts`</summary>

- [RequestID](/middleware/request_id.go#L63)
- [Logger](/middleware/logger.go#L26)
- [Recoverer](/middleware/recoverer.go#L18)
- [URLFormat](/middleware/url_format.go#L45)
- [SetContentType.func1](https://github.com/go-chi/render/content_type.go#L49)
- **/admin/***
	- [main.AdminOnly](/_examples/rest/main.go#L238)
	- **/accounts**
		- _GET_
			- [main.adminRouter.func2](/_examples/rest/main.go#L228)

</details>
<details>
<summary>`/admin/*/users/{userId}`</summary>

- [RequestID](/middleware/request_id.go#L63)
- [Logger](/middleware/logger.go#L26)
- [Recoverer](/middleware/recoverer.go#L18)
- [URLFormat](/middleware/url_format.go#L45)
- [SetContentType.func1](https://github.com/go-chi/render/content_type.go#L49)
- **/admin/***
	- [main.AdminOnly](/_examples/rest/main.go#L238)
	- **/users/{userId}**
		- _GET_
			- [main.adminRouter.func3](/_examples/rest/main.go#L231)

</details>
<details>
<summary>`/articles/*`</summary>

- [RequestID](/middleware/request_id.go#L63)
- [Logger](/middleware/logger.go#L26)
- [Recoverer](/middleware/recoverer.go#L18)
- [URLFormat](/middleware/url_format.go#L45)
- [SetContentType.func1](https://github.com/go-chi/render/content_type.go#L49)
- **/articles/***
	- **/**
		- _GET_
			- [main.paginate](/_examples/rest/main.go#L251)
			- [main.ListArticles](/_examples/rest/main.go#L117)
		- _POST_
			- [main.CreateArticle](/_examples/rest/main.go#L158)

</details>
<details>
<summary>`/articles/*/search`</summary>

- [RequestID](/middleware/request_id.go#L63)
- [Logger](/middleware/logger.go#L26)
- [Recoverer](/middleware/recoverer.go#L18)
- [URLFormat](/middleware/url_format.go#L45)
- [SetContentType.func1](https://github.com/go-chi/render/content_type.go#L49)
- **/articles/***
	- **/search**
		- _GET_
			- [main.SearchArticles](/_examples/rest/main.go#L152)

</details>
<details>
<summary>`/articles/*/{articleID}/*`</summary>

- [RequestID](/middleware/request_id.go#L63)
- [Logger](/middleware/logger.go#L26)
- [Recoverer](/middleware/recoverer.go#L18)
- [URLFormat](/middleware/url_format.go#L45)
- [SetContentType.func1](https://github.com/go-chi/render/content_type.go#L49)
- **/articles/***
	- **/{articleID}/***
		- [main.ArticleCtx](/_examples/rest/main.go#L127)
		- **/**
			- _DELETE_
				- [main.DeleteArticle](/_examples/rest/main.go#L204)
			- _GET_
				- [main.GetArticle](/_examples/rest/main.go#L176)
			- _PUT_
				- [main.UpdateArticle](/_examples/rest/main.go#L189)

</details>
<details>
<summary>`/articles/*/{articleSlug:[a-z-]+}`</summary>

- [RequestID](/middleware/request_id.go#L63)
- [Logger](/middleware/logger.go#L26)
- [Recoverer](/middleware/recoverer.go#L18)
- [URLFormat](/middleware/url_format.go#L45)
- [SetContentType.func1](https://github.com/go-chi/render/content_type.go#L49)
- **/articles/***
	- **/{articleSlug:[a-z-]+}**
		- _GET_
			- [main.ArticleCtx](/_examples/rest/main.go#L127)
			- [main.GetArticle](/_examples/rest/main.go#L176)

</details>
<details>
<summary>`/panic`</summary>

- [RequestID](/middleware/request_id.go#L63)
- [Logger](/middleware/logger.go#L26)
- [Recoverer](/middleware/recoverer.go#L18)
- [URLFormat](/middleware/url_format.go#L45)
- [SetContentType.func1](https://github.com/go-chi/render/content_type.go#L49)
- **/panic**
	- _GET_
		- [main.main.func3](/_examples/rest/main.go#L77)

</details>
<details>
<summary>`/ping`</summary>

- [RequestID](/middleware/request_id.go#L63)
- [Logger](/middleware/logger.go#L26)
- [Recoverer](/middleware/recoverer.go#L18)
- [URLFormat](/middleware/url_format.go#L45)
- [SetContentType.func1](https://github.com/go-chi/render/content_type.go#L49)
- **/ping**
	- _GET_
		- [main.main.func2](/_examples/rest/main.go#L73)

</details>

Total # of routes: 10

