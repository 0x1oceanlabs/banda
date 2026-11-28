//! The site of a page, which an Agent may use once the Person says so
//! (ADR 0029, decision 7, B), as the window's main process finds it
//! (`apps/browser/desktop/src/hands.ts`, `siteAt` and `ruleAt`): the two
//! give one answer for one address, so a rule of `browser.toml` means the
//! same in a window's tab and in a machine's.

use crate::settings::SiteRule;
use std::collections::BTreeMap;

/// Where a web page is: its host, which a rule may name, and its site.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Site {
    pub host: String,
    /// Its domain, as a browser takes a site to be, by the Public Suffix
    /// List with its private part: github.com covers gist.github.com, and
    /// each `*.github.io` is a site of its own. A host with no such domain,
    /// as an IP address or a bare name, is its own site.
    pub site: String,
}

/// The site of the page at `url`. None for this computer's own pages,
/// which never ask, nor for a page not of the web.
pub(crate) fn at(url: &str) -> Option<Site> {
    let address = url::Url::parse(url).ok()?;
    if !matches!(address.scheme(), "http" | "https") {
        return None;
    }
    // As a browser names it: lowercase, an IPv6 one in [].
    let host = address.host_str()?.to_owned();
    if ["localhost", "127.0.0.1", "[::1]"].contains(&host.as_str()) {
        return None;
    }
    let site = match address.host()? {
        url::Host::Domain(name) => {
            // A name that ends in a dot is the same name.
            let name = name.strip_suffix('.').unwrap_or(name);
            psl::domain_str(name).unwrap_or(name).to_owned()
        }
        url::Host::Ipv4(_) | url::Host::Ipv6(_) => host.clone(),
    };
    Some(Site { host, site })
}

/// The rule of `rules` for a page at `at`: its host's, or the nearest
/// domain's above it, up to its site's.
pub(crate) fn rule(rules: &BTreeMap<String, SiteRule>, at: &Site) -> Option<SiteRule> {
    let mut name = at.host.as_str();
    loop {
        let rule = rules.get(name).copied();
        if rule.is_some() || name == at.site {
            return rule;
        }
        name = name.split_once('.')?.1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn site(url: &str) -> Option<(String, String)> {
        at(url).map(|at| (at.host, at.site))
    }

    fn named(host: &str, site: &str) -> Option<(String, String)> {
        Some((host.to_owned(), site.to_owned()))
    }

    /// The answers `siteAt` gives in the window, address by address.
    #[test]
    fn a_page_s_site_is_its_domain_as_a_browser_takes_it() {
        assert_eq!(
            site("https://gist.github.com/a?b#c"),
            named("gist.github.com", "github.com")
        );
        assert_eq!(
            site("HTTP://WWW.Example.CO.UK:8080/"),
            named("www.example.co.uk", "example.co.uk")
        );
        // The list's private part counts: each of these is its own site.
        assert_eq!(
            site("https://banda.github.io/docs"),
            named("banda.github.io", "banda.github.io")
        );
        // A name of no known ending, an address and a bare name.
        assert_eq!(
            site("http://wiki.corp.internal/"),
            named("wiki.corp.internal", "corp.internal")
        );
        assert_eq!(
            site("http://192.168.1.20:3000/"),
            named("192.168.1.20", "192.168.1.20")
        );
        assert_eq!(site("http://[fe80::1]/"), named("[fe80::1]", "[fe80::1]"));
        assert_eq!(site("http://devbox:3000/"), named("devbox", "devbox"));
        assert_eq!(site("https://co.uk/"), named("co.uk", "co.uk"));
        // The list's rules for every name under an ending, and but one.
        assert_eq!(
            site("https://a.b.c.kobe.jp/"),
            named("a.b.c.kobe.jp", "b.c.kobe.jp")
        );
        assert_eq!(site("https://www.ck/"), named("www.ck", "www.ck"));
        assert_eq!(
            site("https://a.b.compute.amazonaws.com/"),
            named("a.b.compute.amazonaws.com", "a.b.compute.amazonaws.com")
        );
        assert_eq!(
            site("https://example.com./"),
            named("example.com.", "example.com")
        );
        assert_eq!(
            site("https://пример.рф/"),
            named("xn--e1afmkfd.xn--p1ai", "xn--e1afmkfd.xn--p1ai")
        );
    }

    #[test]
    fn this_computer_s_pages_and_pages_off_the_web_have_no_site() {
        for url in [
            "http://localhost:5173/",
            "http://127.0.0.1/",
            "http://[::1]:8080/",
            "about:blank",
            "file:///etc/passwd",
            "chrome://settings",
            "not an address",
            "",
        ] {
            assert_eq!(at(url), None, "{url}");
        }
    }

    #[test]
    fn a_rule_is_the_host_s_or_the_nearest_domain_s_up_to_the_site() {
        let rules = BTreeMap::from([
            ("github.com".to_owned(), SiteRule::Allow),
            ("gist.github.com".to_owned(), SiteRule::Deny),
            ("com".to_owned(), SiteRule::Deny),
            ("io".to_owned(), SiteRule::Allow),
        ]);
        let of = |url: &str| rule(&rules, &at(url).unwrap());
        assert_eq!(of("https://github.com/"), Some(SiteRule::Allow));
        assert_eq!(of("https://api.github.com/"), Some(SiteRule::Allow));
        assert_eq!(of("https://a.b.gist.github.com/"), Some(SiteRule::Deny));
        // Never above the site: a rule for an ending covers nothing.
        assert_eq!(of("https://example.com/"), None);
        assert_eq!(of("https://banda.github.io/"), None);
        assert_eq!(of("http://192.168.1.20/"), None);
    }
}
