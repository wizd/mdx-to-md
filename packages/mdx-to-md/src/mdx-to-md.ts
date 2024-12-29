import { NodeHtmlMarkdown } from "node-html-markdown"
import { bundleMDX } from "mdx-bundler"
import type { BundleMDX } from "mdx-bundler/dist/types"
import { getMDXComponent } from "mdx-bundler/client"
import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { readFile } from "fs/promises"
import { dirname, resolve, join } from "path"
import { existsSync } from "fs"

const htmlToMarkdown = new NodeHtmlMarkdown({
  ignore: ["img"], // 防止 node-html-markdown 处理图片标签
})

/**
 * 尝试在多个位置查找组件
 * @param componentPath 组件路径
 * @param mdxFilePath MDX文件路径
 * @returns 找到的组件路径或null
 */
function resolveComponentPath(componentPath: string, mdxFilePath: string): string | null {
  const mdxDir = dirname(mdxFilePath)
  const projectRoot = process.cwd()

  // 可能的组件位置
  const possiblePaths = [
    // 1. 相对于MDX文件的路径
    join(mdxDir, componentPath),
    // 2. 从项目根目录components/开始的路径
    join(projectRoot, componentPath),
    join(projectRoot, "components", componentPath.replace("components/", "")),
    // 3. 包内部的components目录
    resolve(__dirname, "components", componentPath.replace("components/", "")),
  ]

  // 对每个可能的路径尝试不同的文件扩展名
  const extensions = [
    ".jsx",
    ".tsx",
    ".js",
    ".ts",
    "/index.jsx",
    "/index.tsx",
    "/index.js",
    "/index.ts",
  ]

  for (const basePath of possiblePaths) {
    for (const ext of extensions) {
      const fullPath = basePath.endsWith(ext) ? basePath : basePath + ext
      if (existsSync(fullPath)) {
        return fullPath
      }
    }
  }

  return null
}

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
      platform: "node",
      define: {
        "process.env.NODE_ENV": '"production"',
        "process.env.__TESTING__": "true",
      },
      external: ["path", "fs", "stream", "zlib", "components/*"],
      plugins: [
        {
          name: "component-resolver",
          setup(build) {
            build.onResolve({ filter: /^components\// }, ({ path: componentPath, importer }) => {
              const resolvedPath = resolveComponentPath(componentPath, importer || path)
              if (resolvedPath) {
                return {
                  path: resolvedPath,
                  namespace: "component",
                }
              }
              // 如果找不到组件，返回详细的错误信息
              throw new Error(
                `Component not found: ${componentPath}. Searched in:\n` +
                  `- Relative to MDX file (${dirname(importer || path)})\n` +
                  `- Project root (${process.cwd()})\n` +
                  `- Package components directory (${resolve(__dirname, "components")})`
              )
            })
          },
        },
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
