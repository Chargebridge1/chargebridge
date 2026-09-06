const setItemAsync = jest.fn<Promise<void>, [string, string]>(() =>
  Promise.resolve(undefined),
);
const getItemAsync = jest.fn<Promise<string | null>, [string]>(() =>
  Promise.resolve(null),
);
const deleteItemAsync = jest.fn<Promise<void>, [string]>(() =>
  Promise.resolve(undefined),
);

export { setItemAsync, getItemAsync, deleteItemAsync };
