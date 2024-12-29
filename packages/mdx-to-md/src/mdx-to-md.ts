import { NodeHtmlMarkdown } from "node-html-markdown"
import { bundleMDX } from "mdx-bundler"
import type { BundleMDX } from "mdx-bundler/dist/types"
import { getMDXComponent } from "mdx-bundler/client"
import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { readFile } from "fs/promises"
import { dirname, resolve } from "path"

const htmlToMarkdown = new NodeHtmlMarkdown({
  ignore: ["img"], // 防止 node-html-markdown 处理图片标签
})

/**
 * Converts MDX to Markdown. This is useful for rendering dynamic README.md files.
 */
export async function mdxToMd<
  Frontmatter extends {
    [key: string]: any
  }
>(
  /** The path to the MDX file. */
  path: string,

  /** Configure internal library options. */
  options?: Pick<BundleMDX<Frontmatter>, "esbuildOptions" | "grayMatterOptions" | "mdxOptions">
) {
  const contents = await readFile(path, "utf-8")
  const { code } = await bundleMDX({
    source: contents,
    cwd: dirname(path),
    ...options,
    esbuildOptions: (options) => ({
      ...options,
      outdir: dirname(path),
      publicPath: ".",
      define: {
        "process.env.NODE_ENV": '"production"',
        "process.env.__TESTING__": "true",
      },
      plugins: [
        {
          name: "image-resolver",
          setup(build) {
            build.onResolve({ filter: /\.(png|jpe?g|gif|svg)$/ }, ({ path: imagePath }) => {
              return {
                path: imagePath,
                namespace: "image-url",
              }
            })
            build.onLoad({ filter: /.*/, namespace: "image-url" }, ({ path }) => {
              return {
                contents: `export default ${JSON.stringify(path)}`,
                loader: "js",
              }
            })
          },
        },
        ...(Array.isArray(options.plugins) ? options.plugins : []),
      ],
    }),
  })

  const component = getMDXComponent(code)
  const element = createElement(component)
  const html = renderToString(element)

  // 处理 HTML 中的图片标签，保持原始路径
  const processedHtml = html.replace(
    /<img([^>]*)src="([^"]*)"([^>]*)>/g,
    (match, pre, src, post) => {
      const alt = post.match(/alt="([^"]*)"/)
      return `![${alt ? alt[1] : ""}](${src.replace(/\\/g, "/")})`
    }
  )

  const markdown = htmlToMarkdown.translate(processedHtml)
  return markdown
}
