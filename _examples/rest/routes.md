# github.com/pressly/chi

Welcome to the chi/_examples/rest generated docs.

## Routes

<details>
<summary>``</summary>

- [RequestID](/middleware/request_id.go#L63)
- [Logger](/middleware/logger.go#L22)
- [Recoverer](/middleware/recoverer.go#L18)
- **/**
	- _GET_
		- [main.main.func1](/_examples/rest/main.go#L66)

</details>
<details>
<summary>`/admin`</summary>

- [RequestID](/middleware/request_id.go#L63)
- [Logger](/middleware/logger.go#L22)
- [Recoverer](/middleware/recoverer.go#L18)
- **/admin**
	- [main.AdminOnly](/_examples/rest/main.go#L241)
	- **/**
		- _GET_
			- [main.adminRouter.func1](/_examples/rest/main.go#L228)

</details>
<details>
<summary>`/admin/accounts`</summary>

- [RequestID](/middleware/request_id.go#L63)
- [Logger](/middleware/logger.go#L22)
- [Recoverer](/middleware/recoverer.go#L18)
- **/admin**
	- [main.AdminOnly](/_examples/rest/main.go#L241)
	- **/accounts**
		- _GET_
			- [main.adminRouter.func2](/_examples/rest/main.go#L231)

</details>
<details>
<summary>`/admin/users/:userId`</summary>

- [RequestID](/middleware/request_id.go#L63)
- [Logger](/middleware/logger.go#L22)
- [Recoverer](/middleware/recoverer.go#L18)
- **/admin**
	- [main.AdminOnly](/_examples/rest/main.go#L241)
	- **/users/:userId**
		- _GET_
			- [main.adminRouter.func3](/_examples/rest/main.go#L234)

</details>
<details>
<summary>`/articles`</summary>

- [RequestID](/middleware/request_id.go#L63)
- [Logger](/middleware/logger.go#L22)
- [Recoverer](/middleware/recoverer.go#L18)
- **/articles**
	- **/**
		- _GET_
			- [main.paginate](/_examples/rest/main.go#L254)
			- [main.ListArticles](/_examples/rest/main.go#L147)
		- _POST_
			- [main.CreateArticle](/_examples/rest/main.go#L153)

</details>
<details>
<summary>`/articles/:articleID`</summary>

- [RequestID](/middleware/request_id.go#L63)
- [Logger](/middleware/logger.go#L22)
- [Recoverer](/middleware/recoverer.go#L18)
- **/articles**
	- **/:articleID**
		- [main.ArticleCtx](/_examples/rest/main.go#L125)
		- **/**
			- _PUT_
				- [main.UpdateArticle](/_examples/rest/main.go#L188)
			- _DELETE_
				- [main.DeleteArticle](/_examples/rest/main.go#L206)
			- _GET_
				- [main.GetArticle](/_examples/rest/main.go#L176)

</details>
<details>
<summary>`/articles/search`</summary>

- [RequestID](/middleware/request_id.go#L63)
- [Logger](/middleware/logger.go#L22)
- [Recoverer](/middleware/recoverer.go#L18)
- **/articles**
	- **/search**
		- _GET_
			- [main.SearchArticles](/_examples/rest/main.go#L141)

</details>
<details>
<summary>`/panic`</summary>

- [RequestID](/middleware/request_id.go#L63)
- [Logger](/middleware/logger.go#L22)
- [Recoverer](/middleware/recoverer.go#L18)
- **/panic**
	- _GET_
		- [main.main.func3](/_examples/rest/main.go#L74)

</details>
<details>
<summary>`/ping`</summary>

- [RequestID](/middleware/request_id.go#L63)
- [Logger](/middleware/logger.go#L22)
- [Recoverer](/middleware/recoverer.go#L18)
- **/ping**
	- _GET_
		- [main.main.func2](/_examples/rest/main.go#L70)

</details>

Total # of routes: 9

