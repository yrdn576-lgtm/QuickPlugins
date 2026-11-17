/*
 * QuickPlugins - Vencord userplugin
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import {
    isPluginEnabled,
    pluginRequiresRestart,
    startDependenciesRecursive,
    startPlugin,
    stopPlugin
} from "@api/PluginManager";
import { showNotice } from "@api/Notices";
import { Settings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { openPluginModal } from "@components/settings/tabs/plugins/PluginModal";
import { promptToRestart } from "@utils/promptToRestart";
import definePlugin, { Plugin } from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";
import {
    Modal,
    openModal,
    showToast,
    useEffect,
    useRef,
    useState
} from "@webpack/common";

import Plugins from "~plugins";

const PanelButton = findComponentByCodeLazy(
    ".GREEN,positionKeyStemOverride:"
);

function PuzzleIcon() {
    return (
        <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
        >
            <path d="M9 2.5a2.5 2.5 0 0 1 5 0V4h4a2 2 0 0 1 2 2v3h1.5a2.5 2.5 0 0 1 0 5H20v4a2 2 0 0 1-2-2v-4h1.5a2 2 0 0 0 0-4H20V6a2 2 0 0 0-2-2h-4V2.5a2.5 2.5 0 0 0-5 0V4H6a2 2 0 0 0-2 2v3h1.5a2.5 2.5 0 0 1 0 5H4v4a2 2 0 0 0 2 2h3v-1.5a2.5 2.5 0 0 1 5 0V20h4a2 2 0 0 0 2-2v-4h-1.5a2.5 2.5 0 0 1 0-5H20" />
        </svg>
    );
}

function SearchIcon() {
    return (
        <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
        >
            <circle cx="11" cy="11" r="7" />
            <path d="m16 16 5 5" />
        </svg>
    );
}

function SettingsIcon() {
    return (
        <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <circle cx="12" cy="12" r="3" />
            <path d="M19 13.5V10.5L16.8 10a5 5 0 0 0-.7-1.2l.7-2.2-2.4-1.4-1.6 1.6a5 5 0 0 0-1.6 0L9.6 5.2 7.2 6.6l.7 2.2a5 5 0 0 0-.7 1.2L5 10.5v3l2.2.5a5 5 0 0 0 .7 1.2l-.7 2.2 2.4 1.4 1.6-1.6a5 5 0 0 0 1.6 0l1.6 1.6 2.4-1.4-.7-2.2a5 5 0 0 0 .7-1.2Z" />
            <circle cx="12" cy="12" r="2.5" />
        </svg>
    );
}

type PluginFilter = "all" | "enabled" | "disabled";

function QuickPluginsContent() {
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<PluginFilter>("all");
    const [, refresh] = useState(0);

    const restartChanges = useRef(new Set<string>());

    useEffect(() => {
        return () => {
            if (restartChanges.current.size > 0) {
                promptToRestart("reload", {
                    children: "Plugin changes require a restart to take effect."
                });
            }
        };
    }, []);

    function markRestart(name: string, key: string) {
        const id = `${name}.${key}`;

        if (restartChanges.current.has(id)) {
            restartChanges.current.delete(id);
        } else {
            restartChanges.current.add(id);
        }
    }

    function togglePlugin(plugin: Plugin) {
        const wasEnabled = isPluginEnabled(plugin.name);
        const pluginSettings = Settings.plugins[plugin.name];

        if (!wasEnabled) {
            const { restartNeeded, failures } =
                startDependenciesRecursive(plugin);

            if (failures.length) {
                showNotice(
                    "Failed to start dependencies: " + failures.join(", "),
                    "Close",
                    () => null
                );
                return;
            }

            if (restartNeeded) {
                pluginSettings.enabled = true;
                markRestart(plugin.name, "enabled");
                refresh(n => n + 1);
                return;
            }
        }

        if (pluginRequiresRestart(plugin)) {
            pluginSettings.enabled = !wasEnabled;
            markRestart(plugin.name, "enabled");
            refresh(n => n + 1);
            return;
        }

        if (wasEnabled && !plugin.started) {
            pluginSettings.enabled = false;
            refresh(n => n + 1);
            return;
        }

        const success = wasEnabled
            ? stopPlugin(plugin)
            : startPlugin(plugin);

        if (!success) {
            pluginSettings.enabled = false;

            showToast({
                text: `Failed to ${
                    wasEnabled ? "stop" : "start"
                } ${plugin.name}`,
                variant: "critical",
                position: "bottom"
            });

            refresh(n => n + 1);
            return;
        }

        pluginSettings.enabled = !wasEnabled;
        refresh(n => n + 1);
    }

    const allPlugins = Object.values(Plugins)
        .filter(plugin => !plugin.hidden)
        .sort((a, b) => a.name.localeCompare(b.name));

    const enabledCount = allPlugins.filter(plugin =>
        isPluginEnabled(plugin.name)
    ).length;

    const visiblePlugins = allPlugins.filter(plugin => {
        const enabled = isPluginEnabled(plugin.name);

        if (filter === "enabled" && !enabled) return false;
        if (filter === "disabled" && enabled) return false;

        const searchText = (
            plugin.name + " " + plugin.description
        ).toLowerCase();

        return searchText.includes(
            query.toLowerCase().trim()
        );
    });

    function isLocked(plugin: Plugin) {
        if (plugin.required || plugin.isDependency) return true;

        return allPlugins.some(other =>
            other.name !== plugin.name &&
            isPluginEnabled(other.name) &&
            other.dependencies?.includes(plugin.name)
        );
    }

    return (
        <div className="vc-quickplugins-popover">
            <div className="vc-quickplugins-search">
                <SearchIcon />

                <input
                    type="text"
                    placeholder="Search plugins..."
                    value={query}
                    onChange={event =>
                        setQuery(event.target.value)
                    }
                    aria-label="Search plugins"
                />
            </div>

            <div className="vc-quickplugins-filters">
                {(["all", "enabled", "disabled"] as const).map(
                    value => (
                        <button
                            key={value}
                            type="button"
                            className={
                                filter === value ? "active" : ""
                            }
                            onClick={() => setFilter(value)}
                        >
                            {value === "all"
                                ? "All"
                                : value === "enabled"
                                    ? "Enabled"
                                    : "Disabled"}
                        </button>
                    )
                )}
            </div>

            <div className="vc-quickplugins-list">
                {visiblePlugins.length === 0 && (
                    <div className="vc-quickplugins-empty">
                        No matching plugins
                    </div>
                )}

                {visiblePlugins.map(plugin => {
                    const enabled = isPluginEnabled(plugin.name);
                    const locked = isLocked(plugin);

                    return (
                        <div
                            className="vc-quickplugins-item"
                            key={plugin.name}
                        >
                            <div className="vc-quickplugins-info">
                                <div className="vc-quickplugins-name">
                                    {plugin.name}
                                </div>

                                <div
                                    className="vc-quickplugins-description"
                                    title={plugin.description}
                                >
                                    {plugin.description}
                                </div>
                            </div>

                            <button
                                type="button"
                                className="vc-quickplugins-settings"
                                title={`Settings for ${plugin.name}`}
                                aria-label={`Settings for ${plugin.name}`}
                                onClick={() =>
                                    openPluginModal(
                                        plugin,
                                        markRestart
                                    )
                                }
                            >
                                <SettingsIcon />
                            </button>

                            <button
                                type="button"
                                role="switch"
                                aria-label={`Enable ${plugin.name}`}
                                aria-checked={enabled}
                                disabled={locked}
                                title={
                                    locked
                                        ? "Required by Vencord or another plugin"
                                        : enabled
                                            ? "Disable plugin"
                                            : "Enable plugin"
                                }
                                className={
                                    "vc-quickplugins-toggle" +
                                    (enabled ? " enabled" : "")
                                }
                                onClick={() =>
                                    togglePlugin(plugin)
                                }
                            >
                                <span />
                            </button>
                        </div>
                    );
                })}
            </div>

            <div className="vc-quickplugins-footer">
                {visiblePlugins.length} plugins shown
            </div>
        </div>
    );
}

function openQuickPluginsModal() {
    openModal(modalProps => (
        <Modal
            {...modalProps}
            title="Quick Plugins"
        >
            <ErrorBoundary noop>
                <QuickPluginsContent />
            </ErrorBoundary>
        </Modal>
    ));
}

function QuickPluginsButton(props: { nameplate?: any; }) {
    return (
        <PanelButton
            tooltipText="Quick Plugins"
            icon={PuzzleIcon}
            plated={props?.nameplate != null}
            onClick={openQuickPluginsModal}
        />
    );
}

export default definePlugin({
    name: "QuickPlugins",
    description:
        "Manage Vencord plugins from the account panel.",
    authors: [],
    tags: ["Utility", "Appearance"],

    patches: [{
        find: "#{intl::USER_PROFILE_ACCOUNT_POPOUT_BUTTON_A11Y_LABEL}",
        replacement: {
            // Insert before the Settings/Suspense expression,
            // not at the beginning of the controls array.
            match: /,(?=null!=\i\.\i\?\(0,\i\.jsx\)\(\i\.Suspense,\{fallback:\i\(\),children:)/,
            replace: ",$self.QuickPluginsButton(arguments[0]),"
        }
    }],

    QuickPluginsButton: ErrorBoundary.wrap(
        QuickPluginsButton,
        { noop: true }
    )
});
