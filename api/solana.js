import {
  createRpcProxy,
  RPC_BODY_LIMIT,
  RpcProxyError,
  validateRpcOrigin,
} from "../src/lib/rpcProxy.js";
import { Buffer } from "node:buffer";
import process from "node:process";

const forward = createRpcProxy();

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Only POST is supported." });
  }
  let id = null;
  try {
    validateRpcOrigin(request.headers, process.env);
    if (
      !/^application\/json(?:;|$)/i.test(request.headers["content-type"] ?? "")
    )
      throw new RpcProxyError("JSON content type is required.", 415);
    if (Number(request.headers["content-length"]) > RPC_BODY_LIMIT)
      throw new RpcProxyError("RPC request is too large.", 413);
    let body = request.body;
    if (body === undefined) {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > RPC_BODY_LIMIT)
          throw new RpcProxyError("RPC request is too large.", 413);
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks).toString("utf8");
    }
    if (Buffer.isBuffer(body)) body = body.toString("utf8");
    const encoded = typeof body === "string" ? body : JSON.stringify(body);
    if (
      typeof encoded !== "string" ||
      Buffer.byteLength(encoded) > RPC_BODY_LIMIT
    )
      throw new RpcProxyError("RPC request is too large.", 413);
    let rpc;
    try {
      rpc = JSON.parse(encoded);
    } catch {
      throw new RpcProxyError("Invalid JSON request.", 400, -32700);
    }
    if (
      (typeof rpc?.id === "string" && rpc.id.length <= 100) ||
      Number.isSafeInteger(rpc?.id)
    )
      id = rpc.id;
    const identity =
      request.headers["x-vercel-forwarded-for"] ??
      request.headers["x-forwarded-for"] ??
      request.socket?.remoteAddress ??
      "unknown";
    return response.status(200).json(await forward(rpc, identity));
  } catch (error) {
    const known = error instanceof RpcProxyError;
    const status = known ? error.status : 502;
    if (status === 429) response.setHeader("Retry-After", "2");
    return response
      .status(status)
      .json({
        jsonrpc: "2.0",
        id,
        error: {
          code: known ? error.code : -32000,
          message: known
            ? error.message
            : "UAT RPC is temporarily unavailable.",
        },
      });
  }
}
