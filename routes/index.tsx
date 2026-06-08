import { Head } from "fresh/runtime";
import { loadVillageIceServers } from "../features/village/server/ice.ts";
import VillageApp from "../islands/VillageApp.tsx";
import { define } from "../utils.ts";

export const handler = define.handlers({
  async GET(ctx) {
    return {
      data: {
        iceServers: await loadVillageIceServers(),
        initialJoinCode: ctx.url.searchParams.get("code")?.trim() ?? "",
      },
    };
  },
});

export default define.page<typeof handler>(function Home({ data }) {
  return (
    <>
      <Head>
        <title>It Takes a Village</title>
      </Head>
      <VillageApp
        iceServers={data.iceServers}
        initialJoinCode={data.initialJoinCode}
      />
    </>
  );
});
