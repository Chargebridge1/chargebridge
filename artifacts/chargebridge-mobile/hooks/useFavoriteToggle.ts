import { useQueryClient } from "@tanstack/react-query";
import { useListFavorites, useAddFavorite, useRemoveFavorite } from "@/lib/api-client";
import { getListFavoritesQueryKey } from "@/lib/api-client/generated/api";

export function useFavoriteToggle(
  stationId: number | string | undefined,
  externalStationData?: Record<string, unknown>,
) {
  const qc = useQueryClient();
  const { data: favorites } = useListFavorites();
  const addFav = useAddFavorite();
  const removeFav = useRemoveFavorite();

  const isCommunity = typeof stationId === "number";

  const isFavorited =
    stationId != null
      ? isCommunity
        ? (favorites ?? []).some((f) => f.source === "community" && f.id === String(stationId))
        : (favorites ?? []).some((f) => f.externalStationId === stationId)
      : false;

  const isPending = addFav.isPending || removeFav.isPending;

  function toggle() {
    if (stationId == null) return;
    const invalidate = () =>
      qc.invalidateQueries({ queryKey: getListFavoritesQueryKey() });

    if (isFavorited) {
      removeFav.mutate({ stationId: String(stationId) }, { onSuccess: invalidate });
    } else {
      if (isCommunity) {
        addFav.mutate({ data: { stationId } }, { onSuccess: invalidate });
      } else {
        addFav.mutate(
          { data: { externalStationId: String(stationId), externalStationData: externalStationData ?? {} } },
          { onSuccess: invalidate },
        );
      }
    }
  }

  return { isFavorited, toggle, isPending };
}
