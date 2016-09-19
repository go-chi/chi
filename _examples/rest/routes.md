# github.com/pressly/chi/_examples/rest

Routing docs generated with chi/docgen. Run xx to regenerate the docs.

## Routes

<details>
<summary>/</summary>

- [RequestID](middleware/recoverer.go#L18)
- [Logger](middleware/recoverer.go#L18)
- [Recoverer](middleware/recoverer.go#L18)
- **/**
	- _GET_
		- [main.main.func1]()

</details>
<details>
<summary>/admin/</summary>

- [RequestID](middleware/recoverer.go#L18)
- [Logger](middleware/recoverer.go#L18)
- [Recoverer](middleware/recoverer.go#L18)
- **/admin**
	- [main.AdminOnly](middleware/recoverer.go#L18)
	- **/**
		- _GET_
			- [main.adminRouter.func1]()

</details>
<details>
<summary>/admin/accounts</summary>

- [RequestID](middleware/recoverer.go#L18)
- [Logger](middleware/recoverer.go#L18)
- [Recoverer](middleware/recoverer.go#L18)
- **/admin**
	- [main.AdminOnly](middleware/recoverer.go#L18)
	- **/accounts**
		- _GET_
			- [main.adminRouter.func2]()

</details>
<details>
<summary>/admin/users/:userId</summary>

- [RequestID](middleware/recoverer.go#L18)
- [Logger](middleware/recoverer.go#L18)
- [Recoverer](middleware/recoverer.go#L18)
- **/admin**
	- [main.AdminOnly](middleware/recoverer.go#L18)
	- **/users/:userId**
		- _GET_
			- [main.adminRouter.func3]()

</details>
<details>
<summary>/articles/</summary>

- [RequestID](middleware/recoverer.go#L18)
- [Logger](middleware/recoverer.go#L18)
- [Recoverer](middleware/recoverer.go#L18)
- **/articles**
	- **/**
		- _GET_
			- [main.paginate]()
			- [main.ListArticles]()
		- _POST_
			- [main.CreateArticle]()

</details>
<details>
<summary>/articles/:articleID/</summary>

- [RequestID](middleware/recoverer.go#L18)
- [Logger](middleware/recoverer.go#L18)
- [Recoverer](middleware/recoverer.go#L18)
- **/articles**
	- **/:articleID**
		- [main.ArticleCtx](middleware/recoverer.go#L18)
		- **/**
			- _PUT_
				- [main.UpdateArticle]()
			- _DELETE_
				- [main.DeleteArticle]()
			- _GET_
				- [main.GetArticle]()

</details>
<details>
<summary>/articles/search</summary>

- [RequestID](middleware/recoverer.go#L18)
- [Logger](middleware/recoverer.go#L18)
- [Recoverer](middleware/recoverer.go#L18)
- **/articles**
	- **/search**
		- _GET_
			- [main.SearchArticles]()

</details>
<details>
<summary>/panic</summary>

- [RequestID](middleware/recoverer.go#L18)
- [Logger](middleware/recoverer.go#L18)
- [Recoverer](middleware/recoverer.go#L18)
- **/panic**
	- _GET_
		- [main.main.func3]()

</details>
<details>
<summary>/ping</summary>

- [RequestID](middleware/recoverer.go#L18)
- [Logger](middleware/recoverer.go#L18)
- [Recoverer](middleware/recoverer.go#L18)
- **/ping**
	- _GET_
		- [main.main.func2]()

</details>

Total # of routes: 9

