import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

export type ButtonConfig = {
  key: string;
  label: string;
  platform: string;
  location: string;
  description: string;
  enabled: boolean;
};

export function useButtonConfigs() {
  return useQuery<ButtonConfig[]>({
    queryKey: ["button-configs"],
    queryFn: async () => {
      try {
        const res = await fetch(`${BASE}/api/button-configs`);
        if (!res.ok) return [];
        return res.json();
      } catch {
        return [];
      }
    },
    staleTime: 60_000,
    gcTime: 300_000,
    initialData: undefined,
  });
}

export function useIsButtonEnabled(key: string, defaultEnabled = true): boolean {
  const { data } = useButtonConfigs();
  if (!data) return defaultEnabled;
  const config = data.find((c) => c.key === key);
  return config?.enabled ?? defaultEnabled;
}

export function useToggleButton() {
  const queryClient = useQueryClient();
  const { getToken } = useAuth();

  return useMutation({
    mutationFn: async ({ key, enabled }: { key: string; enabled: boolean }) => {
      const token = await getToken();
      const res = await fetch(`${BASE}/api/admin/button-configs/${key}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error ?? "Failed to toggle button");
      }
      return res.json() as Promise<ButtonConfig>;
    },
    onMutate: async ({ key, enabled }) => {
      await queryClient.cancelQueries({ queryKey: ["button-configs"] });
      const prev = queryClient.getQueryData<ButtonConfig[]>(["button-configs"]);
      queryClient.setQueryData<ButtonConfig[]>(["button-configs"], (old) =>
        old?.map((c) => (c.key === key ? { ...c, enabled } : c)) ?? old
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["button-configs"], ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["button-configs"] });
    },
  });
}
