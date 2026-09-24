/*
Copyright 2021-2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  type FC,
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "@vector-im/compound-web";
import { createClient } from "matrix-js-sdk";
import { logger } from "matrix-js-sdk/lib/logger";

import Logo from "../icons/LogoLarge.svg?react";
import { useClient } from "../ClientContext";
import { FieldRow, InputField, ErrorMessage } from "../input/Input";
import styles from "./LoginPage.module.css";
import { useInteractiveLogin } from "./useInteractiveLogin";
import { usePageTitle } from "../usePageTitle";
import { PosthogAnalytics } from "../analytics/PosthogAnalytics";
import { Config } from "../config/Config";
import { Link } from "../button/Link";
import { initClient } from "../utils/matrix";

export const LoginPage: FC = () => {
  const { t } = useTranslation();
  usePageTitle(t("login_title"));

  const { client, setClient } = useClient();
  const login = useInteractiveLogin(client);
  const homeserver = Config.defaultHomeserverUrl(); // TODO: Make this configurable
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error>();

  // On mount: check for a loginToken (returned by the Matrix SSO redirect) and
  // detect whether the homeserver supports password login at all. If only SSO
  // is available we skip the form and redirect straight to the SSO provider.
  useEffect(() => {
    if (!homeserver || !setClient) return;

    // Post-SSO: Matrix redirects back with ?loginToken=<token>. Use m.login.token
    // to exchange it for a full session without ever touching password login.
    const searchParams = new URLSearchParams(window.location.search);
    const loginToken = searchParams.get("loginToken");
    if (loginToken) {
      setLoading(true);
      const authClient = createClient({ baseUrl: homeserver });
      authClient
        .login("m.login.token", { token: loginToken })
        .then(async (response) => {
          // Remove the token from the URL so a browser refresh doesn't replay it.
          window.history.replaceState(null, "", window.location.pathname);
          /* eslint-disable camelcase */
          const { user_id, access_token, device_id } = response;
          const newClient = await initClient(
            {
              baseUrl: homeserver,
              accessToken: access_token,
              userId: user_id,
              deviceId: device_id,
            },
            false,
          );
          const session = {
            user_id,
            access_token,
            device_id,
            passwordlessUser: false,
          };
          /* eslint-enable camelcase */
          setClient(newClient, session);
          const locationState = location.state as { from?: string } | null;
          await navigate(locationState?.from ?? "/");
          PosthogAnalytics.instance.eventLogin.track();
        })
        .catch((err: Error) => {
          setError(err);
          setLoading(false);
        });
      return;
    }

    // Detect whether the homeserver supports password login. If it only offers
    // SSO we redirect immediately instead of showing a form that will 400.
    const authClient = createClient({ baseUrl: homeserver });
    authClient
      .loginFlows()
      .then((result) => {
        const hasPassword = result.flows.some(
          (f) => f.type === "m.login.password",
        );
        const ssoFlow = result.flows.find((f) => f.type === "m.login.sso");
        if (!hasPassword && ssoFlow) {
          const idpId = (
            ssoFlow as { identity_providers?: { id: string }[] }
          ).identity_providers?.[0]?.id;
          const redirectUrl = encodeURIComponent(window.location.href);
          const ssoPath = idpId
            ? `/_matrix/client/v3/login/sso/redirect/${idpId}`
            : "/_matrix/client/v3/login/sso/redirect";
          window.location.href = `${homeserver}${ssoPath}?redirectUrl=${redirectUrl}`;
        }
      })
      .catch((err: unknown) => logger.error("Failed to fetch login flows", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmitLoginForm = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setLoading(true);

      if (!homeserver || !usernameRef.current || !passwordRef.current) {
        setError(Error("Login parameters are undefined"));
        setLoading(false);
        return;
      }

      login(homeserver, usernameRef.current.value, passwordRef.current.value)
        .then(async ([client, session]) => {
          if (!setClient) {
            return;
          }

          setClient(client, session);

          const locationState = location.state;
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          if (locationState && locationState.from) {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            await navigate(locationState.from);
          } else {
            await navigate("/");
          }
          PosthogAnalytics.instance.eventLogin.track();
        })
        .catch((error) => {
          setError(error);
          setLoading(false);
        });
    },
    [login, location, navigate, homeserver, setClient],
  );
  // we need to limit the length of the homserver name to not cover the whole loginview input with the string.
  let shortendHomeserverName = Config.defaultServerName()?.slice(0, 25);
  shortendHomeserverName =
    shortendHomeserverName?.length !== Config.defaultServerName()?.length
      ? shortendHomeserverName + "..."
      : shortendHomeserverName;
  return (
    <>
      <div className={styles.container}>
        <div className={styles.content}>
          <div className={styles.formContainer}>
            <Logo width="auto" height="auto" className={styles.logo} />

            <h2>{t("log_in")}</h2>
            <h4>{t("login_subheading")}</h4>
            <form onSubmit={onSubmitLoginForm}>
              <FieldRow>
                <InputField
                  type="text"
                  ref={usernameRef}
                  placeholder={t("common.username")}
                  label={t("common.username")}
                  autoCorrect="off"
                  autoCapitalize="none"
                  prefix="@"
                  suffix={`:${shortendHomeserverName}`}
                  data-testid="login_username"
                />
              </FieldRow>
              <FieldRow>
                <InputField
                  type="password"
                  ref={passwordRef}
                  placeholder={t("common.password")}
                  label={t("common.password")}
                  data-testid="login_password"
                />
              </FieldRow>
              {error && (
                <FieldRow>
                  <ErrorMessage error={error} />
                </FieldRow>
              )}
              <FieldRow>
                <Button
                  type="submit"
                  disabled={loading}
                  data-testid="login_login"
                >
                  {loading ? t("logging_in") : t("login_title")}
                </Button>
              </FieldRow>
            </form>
          </div>
          <div className={styles.authLinks}>
            <p>{t("login_auth_links_prompt")}</p>
            <p>
              <Trans i18nKey="login_auth_links">
                <Link to="/register">Create an account</Link>
                {" Or "}
                <Link to="/">Access as a guest</Link>
              </Trans>
            </p>
          </div>
        </div>
      </div>
    </>
  );
};
