import { getRequestConfig } from 'next-intl/server';
import upstreamRequestConfig from './request';
import { withComailMessages } from './comail-messages';

export default getRequestConfig(async (params) => {
  const config = await upstreamRequestConfig(params);
  return {
    ...config,
    messages: withComailMessages(config.locale, config.messages ?? {}),
  };
});
