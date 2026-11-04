//! Test USDC (SRD §4.2): a NEP-141 token with NEP-145 storage registration and a faucet. It is the sandbox's USDC
//! and the testnet fallback if Circle's testnet USDC can't be had (O-17). Never used on mainnet.
#![allow(deprecated)] // the standards crate's macros are marked deprecated but are the supported shortcut
use near_contract_standards::fungible_token::FungibleToken;
use near_contract_standards::fungible_token::metadata::{FT_METADATA_SPEC, FungibleTokenMetadata, FungibleTokenMetadataProvider};
use near_contract_standards::impl_fungible_token_core;
use near_contract_standards::storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement};
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue, env, near, require};

const FAUCET_AMOUNT: u128 = 10_000_000; // 10 USDC, 6 decimals
const FAUCET_EVERY_SECS: u64 = 24 * 60 * 60;

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Token,
    Faucet,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    token: FungibleToken,
    last_mint: LookupMap<AccountId, u64>,
}

#[near]
impl Contract {
    #[init]
    pub fn new() -> Self {
        Self { token: FungibleToken::new(Key::Token), last_mint: LookupMap::new(Key::Faucet) }
    }

    /// 10 test USDC for the caller, once per 24 h. Registers the caller on the token if needed (the token pays).
    pub fn faucet_mint(&mut self) {
        let caller = env::predecessor_account_id();
        let now = env::block_timestamp_ms() / 1000;
        require!(self.last_mint.get(&caller).is_none_or(|t| now >= t + FAUCET_EVERY_SECS), "Faucet: once per 24 hours");
        self.last_mint.insert(caller.clone(), now);
        self.credit(&caller, FAUCET_AMOUNT);
    }

    /// Mints to any account. Only the token's own account may call it, so a test sets balances with its own key.
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        require!(env::predecessor_account_id() == env::current_account_id(), "Only the token account mints");
        self.credit(&account_id, amount.0);
    }
}

impl Contract {
    fn credit(&mut self, account_id: &AccountId, amount: u128) {
        if self.token.accounts.get(account_id).is_none() {
            self.token.internal_register_account(account_id);
        }
        self.token.internal_deposit(account_id, amount);
    }
}

impl_fungible_token_core!(Contract, token);

// written out because the crate's storage macro doesn't match its own trait in this version
#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Test USDC".to_string(),
            symbol: "USDC".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 6,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_contract_standards::fungible_token::core::FungibleTokenCore;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn ctx(who: &str, secs: u64) {
        let mut b = VMContextBuilder::new();
        b.current_account_id("usdc.testnet".parse().unwrap()).predecessor_account_id(who.parse().unwrap()).block_timestamp(secs * 1_000_000_000);
        testing_env!(b.build());
    }

    #[test]
    fn the_faucet_registers_and_pays_once_a_day() {
        ctx("buyer.testnet", 1_000);
        let mut c = Contract::new();
        c.faucet_mint();
        assert_eq!(c.ft_balance_of("buyer.testnet".parse().unwrap()).0, 10_000_000);
        ctx("buyer.testnet", 1_000 + FAUCET_EVERY_SECS);
        c.faucet_mint();
        assert_eq!(c.ft_balance_of("buyer.testnet".parse().unwrap()).0, 20_000_000);
    }

    #[test]
    #[should_panic(expected = "once per 24 hours")]
    fn the_faucet_waits() {
        ctx("buyer.testnet", 1_000);
        let mut c = Contract::new();
        c.faucet_mint();
        ctx("buyer.testnet", 2_000);
        c.faucet_mint();
    }

    #[test]
    #[should_panic(expected = "Only the token account mints")]
    fn only_the_token_account_mints() {
        ctx("buyer.testnet", 1_000);
        let mut c = Contract::new();
        c.mint("buyer.testnet".parse().unwrap(), U128(1));
    }
}
