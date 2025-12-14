"use client";

import { createTRPCReact } from "@trpc/react-query";
import { type AppRouter } from "~/server/routers/_app";

/**
 * tRPC React client
 * Use this to call tRPC procedures in React components
 *
 * @example
 * const { data, isLoading } = trpc.policy.list.useQuery({});
 * const createPolicy = trpc.policy.create.useMutation();
 */
export const trpc = createTRPCReact<AppRouter>();
