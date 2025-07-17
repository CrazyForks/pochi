import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type User, apiClient, authClient } from "@/lib/auth-client";
import { useQuery } from "@tanstack/react-query"; // Added useQuery import
import { createFileRoute } from "@tanstack/react-router";
import {
  Ban,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  Search,
  ShieldCheck,
  ShieldX,
  Undo,
  UserCheck,
  X,
} from "lucide-react";
import { useMemo, useState } from "react"; // Removed useEffect
import { toast } from "sonner";

interface UserQuotaData {
  premiumUsageDetails: Array<{ modelId: string; count: number }>;
}

export const Route = createFileRoute("/_authenticated/admin/users")({
  async loader() {
    const pageSize = 20;
    const users = await fetchUsersPage(pageSize, 0);

    return {
      users,
      pageSize,
      error: null,
    };
  },
  component: UsersPage,
  pendingComponent: UsersPending,
});

function UsersPending() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>User Management</CardTitle>
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function UserQuotaDisplay({ userId }: { userId: string }) {
  const {
    data: quotaData,
    isLoading,
    error,
  } = useQuery<UserQuotaData, Error>({
    queryKey: ["userQuota", userId],
    queryFn: async () => {
      const res = await apiClient.api.billing.quota[":userId"].$get({
        param: { userId },
      });
      if (!res.ok) {
        throw new Error("Failed to fetch quota");
      }
      return await res.json();
    },
  });

  const totalUsed = useMemo(() => {
    if (!quotaData) return 0;
    return quotaData.premiumUsageDetails.reduce(
      (sum, item) => sum + item.count,
      0,
    );
  }, [quotaData]);

  if (isLoading) {
    return <Skeleton className="h-5 w-20" />;
  }

  if (error) {
    return (
      <span className="text-destructive text-xs">Error: {error.message}</span>
    );
  }

  if (!quotaData) {
    return <span className="text-muted-foreground text-xs">N/A</span>;
  }

  return (
    <Button variant="link" className="h-auto p-0 text-xs">
      {totalUsed}
    </Button>
  );
}

function UsersPage() {
  const { users, pageSize, error: loaderError } = Route.useLoaderData(); // Renamed error to loaderError
  const [currentPage, setCurrentPage] = useState(1);
  const [userData, setUserData] = useState(users);
  const [searchResults, setSearchResults] = useState<User[] | null>(null);
  const [userToBan, setUserToBan] = useState<(typeof userList)[0] | null>(null);
  const [userToChangeRole, setUserToChangeRole] = useState<
    (typeof userList)[0] | null
  >(null);
  const [userToImpersonate, setUserToImpersonate] = useState<
    (typeof userList)[0] | null
  >(null);
  const [userToApprove, setUserToApprove] = useState<
    (typeof userList)[0] | null
  >(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  const userList = (userData?.users || []) as User[];

  // Search users using API
  const searchUsers = async (query: string) => {
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }

    setIsSearching(true);
    try {
      const res = await apiClient.api.admin.searchUsers.$get({
        query: { query: query.trim(), limit: "100" },
      });
      if (res.ok) {
        const data = await res.json();
        // Convert date strings to Date objects to match User type
        const usersWithDates = data.users.map((user) => ({
          ...user,
          createdAt: new Date(user.createdAt),
          updatedAt: new Date(user.updatedAt),
          banExpires: user.banExpires ? new Date(user.banExpires) : null,
        })) as User[];
        setSearchResults(usersWithDates);
      }
    } catch (error) {
      console.error("Search error:", error);
      toast.error("Search failed", {
        description: "Failed to search users. Please try again.",
      });
    } finally {
      setIsSearching(false);
    }
  };

  // Debounce search to avoid too many API calls
  const [searchTimeout, setSearchTimeout] = useState<ReturnType<
    typeof setTimeout
  > | null>(null);

  const debouncedSearch = (query: string) => {
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }
    const timeout = setTimeout(() => {
      searchUsers(query);
    }, 300); // 300ms debounce
    setSearchTimeout(timeout);
  };

  const displayUsers = searchQuery.trim() ? searchResults || [] : userList;

  const totalUsers = userData?.total || 0;
  const totalPages = Math.ceil(totalUsers / pageSize);

  const handlePageChange = async (newPage: number) => {
    setCurrentPage(newPage);
    const newUsers = await fetchUsersPage(pageSize, (newPage - 1) * pageSize);
    setUserData(newUsers);
  };

  const handleBanUser = async () => {
    if (!userToBan) return;

    setIsProcessing(true);
    try {
      if (userToBan.banned) {
        await authClient.admin.unbanUser({
          userId: userToBan.id,
        });
        toast.success("User Unbanned", {
          description: `${userToBan.email} has been unbanned successfully.`,
        });
      } else {
        await authClient.admin.banUser({
          userId: userToBan.id,
          banReason: "Banned by administrator",
        });
        toast.success("User Banned", {
          description: `${userToBan.email} has been banned successfully.`,
        });
      }
      const refreshedUsers = await fetchUsersPage(
        pageSize,
        (currentPage - 1) * pageSize,
      );
      setUserData(refreshedUsers);
    } catch (error) {
      toast.error("Error", {
        description: `Failed to ${userToBan.banned ? "unban" : "ban"} user. Please try again.`,
      });
    } finally {
      setIsProcessing(false);
      setUserToBan(null);
    }
  };

  const handleChangeRole = async () => {
    if (!userToChangeRole) return;

    setIsProcessing(true);
    try {
      if (userToChangeRole.role === "admin") {
        await authClient.admin.setRole({
          userId: userToChangeRole.id,
          role: "user",
        });
        toast.success("Role Updated", {
          description: `${userToChangeRole.email} is no longer an admin.`,
        });
      } else {
        await authClient.admin.setRole({
          userId: userToChangeRole.id,
          role: "admin",
        });
        toast.success("Role Updated", {
          description: `${userToChangeRole.email} is now an admin.`,
        });
      }
      const refreshedUsers = await fetchUsersPage(
        pageSize,
        (currentPage - 1) * pageSize,
      );
      setUserData(refreshedUsers);
    } catch (error) {
      toast.error("Error", {
        description: `Failed to update role for ${userToChangeRole.email}. Please try again.`,
      });
    } finally {
      setIsProcessing(false);
      setUserToChangeRole(null);
    }
  };

  const handleImpersonateUser = async () => {
    if (!userToImpersonate) return;

    setIsProcessing(true);
    try {
      await authClient.admin.impersonateUser({
        userId: userToImpersonate.id,
      });

      toast.success("User Impersonated", {
        description: `You are now impersonating ${userToImpersonate.email}. You will be redirected to the dashboard.`,
      });

      setTimeout(() => {
        window.location.href = "/";
      }, 1500);
    } catch (error) {
      toast.error("Error", {
        description: `Failed to impersonate ${userToImpersonate.email}. Please try again.`,
      });
    } finally {
      setIsProcessing(false);
      setUserToImpersonate(null);
    }
  };

  const handleApproveUser = async () => {
    if (!userToApprove) return;

    setIsProcessing(true);
    try {
      await apiClient.api.admin.approveWaitlist.$post({
        query: { userId: userToApprove.id },
      });
      toast.success("User Approved", {
        description: `${userToApprove.email} has been approved successfully.`,
      });

      const refreshedUsers = await fetchUsersPage(
        pageSize,
        (currentPage - 1) * pageSize,
      );
      setUserData(refreshedUsers);
    } catch (error) {
      toast.error("Error Approving User", {
        description: `Failed to approve ${userToApprove.email}. Please try again.`,
      });
    } finally {
      setIsProcessing(false);
      setUserToApprove(null);
    }
  };

  const formatDate = (dateString: string | Date) => {
    const date =
      typeof dateString === "string" ? new Date(dateString) : dateString;
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const renderUsersTable = () => {
    if (loaderError) {
      // Use loaderError
      return (
        <div className="rounded-md border border-destructive bg-destructive/10 p-4 text-center text-destructive">
          Error loading users: {loaderError}
        </div>
      );
    }

    if (displayUsers.length === 0) {
      return (
        <div className="rounded-md border border-border bg-muted/40 p-4 text-center text-muted-foreground">
          {searchQuery.trim()
            ? "No users found matching your search."
            : "No users found."}
        </div>
      );
    }

    return (
      <>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Quota</TableHead>
              <TableHead>Waitlist Approved</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayUsers.map((user) => (
              <TableRow key={user.id}>
                <TableCell>{user.email}</TableCell>
                <TableCell>{user.name || "—"}</TableCell>
                <TableCell>
                  {user.role ? (
                    <Badge
                      variant={user.role === "admin" ? "outline" : "secondary"}
                    >
                      {user.role}
                    </Badge>
                  ) : (
                    "user"
                  )}
                </TableCell>
                <TableCell>
                  {user.banned ? (
                    <Badge variant="destructive">Banned</Badge>
                  ) : user.emailVerified ? (
                    <Badge variant="default">Active</Badge>
                  ) : (
                    <Badge variant="secondary">Inactive</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <UserQuotaDisplay userId={user.id} />
                </TableCell>
                <TableCell>
                  {user.isWaitlistApproved ? (
                    <Badge variant="default">Yes</Badge>
                  ) : (
                    <Badge variant="secondary">No</Badge>
                  )}
                </TableCell>
                <TableCell>{formatDate(user.createdAt)}</TableCell>
                <TableCell className="text-right">
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {!user.banned && !user.isWaitlistApproved && (
                        <>
                          <DropdownMenuItem
                            onClick={() => setUserToApprove(user)}
                            disabled={isProcessing}
                          >
                            <UserCheck className="mr-2 h-4 w-4" />
                            Approve User
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                        </>
                      )}
                      <DropdownMenuItem
                        onClick={() => setUserToChangeRole(user)}
                        disabled={isProcessing}
                      >
                        {user.role === "admin" ? (
                          <>
                            <ShieldX className="mr-2 h-4 w-4" />
                            Remove Admin
                          </>
                        ) : (
                          <>
                            <ShieldCheck className="mr-2 h-4 w-4" />
                            Make Admin
                          </>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setUserToBan(user)}
                        disabled={isProcessing}
                      >
                        {user.banned ? (
                          <>
                            <Undo className="mr-2 h-4 w-4" />
                            Unban
                          </>
                        ) : (
                          <>
                            <Ban className="mr-2 h-4 w-4" />
                            Ban
                          </>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setUserToImpersonate(user)}
                        disabled={isProcessing}
                      >
                        Impersonate
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {!searchQuery.trim() && totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <div className="text-muted-foreground text-sm">
              Showing {(currentPage - 1) * pageSize + 1} to{" "}
              {Math.min(currentPage * pageSize, totalUsers)} of {totalUsers}{" "}
              users
            </div>
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {searchQuery.trim() && (
          <div className="mt-4 text-muted-foreground text-sm">
            Showing {displayUsers.length} user
            {displayUsers.length !== 1 ? "s" : ""} matching "{searchQuery}"
          </div>
        )}
      </>
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>User Management</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex items-center gap-2">
            <div className="relative max-w-sm flex-1">
              {isSearching ? (
                <Loader2 className="-translate-y-1/2 absolute top-1/2 left-3 h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <Search className="-translate-y-1/2 absolute top-1/2 left-3 h-4 w-4 text-muted-foreground" />
              )}
              <Input
                placeholder="Search by email or name..."
                value={searchQuery}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const value = e.target.value;
                  setSearchQuery(value);
                  // Fetch all users when user starts searching
                  if (value.trim()) {
                    debouncedSearch(value);
                  }
                }}
                className="pr-9 pl-9"
              />
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSearchQuery("")}
                  className="-translate-y-1/2 absolute top-1/2 right-1 h-7 w-7 p-0 hover:bg-muted"
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
          {renderUsersTable()}
        </CardContent>
      </Card>

      {/* Ban User Confirmation Dialog */}
      <Dialog
        open={!!userToBan}
        onOpenChange={(open) => !open && setUserToBan(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {userToBan?.banned ? "Unban" : "Ban"} User
            </DialogTitle>
            <DialogDescription>
              {userToBan?.banned
                ? `Are you sure you want to unban ${userToBan?.email}?`
                : `Are you sure you want to ban ${userToBan?.email}?`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setUserToBan(null)}
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button
              variant={userToBan?.banned ? "default" : "destructive"}
              onClick={handleBanUser}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : userToBan?.banned ? (
                "Unban User"
              ) : (
                "Ban User"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Role Confirmation Dialog */}
      <Dialog
        open={!!userToChangeRole}
        onOpenChange={(open) => !open && setUserToChangeRole(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {userToChangeRole?.role === "admin"
                ? "Remove Admin Role"
                : "Make Admin"}
            </DialogTitle>
            <DialogDescription>
              {userToChangeRole?.role === "admin"
                ? `Are you sure you want to remove admin role from ${userToChangeRole?.email}?`
                : `Are you sure you want to make ${userToChangeRole?.email} an admin?`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setUserToChangeRole(null)}
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button
              variant={
                userToChangeRole?.role === "admin" ? "destructive" : "default"
              }
              onClick={handleChangeRole}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : userToChangeRole?.role === "admin" ? (
                "Remove Admin Role"
              ) : (
                "Make Admin"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Impersonate User Confirmation Dialog */}
      <Dialog
        open={!!userToImpersonate}
        onOpenChange={(open) => !open && setUserToImpersonate(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Impersonate User</DialogTitle>
            <DialogDescription>
              {`Are you sure you want to impersonate ${userToImpersonate?.email}?`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setUserToImpersonate(null)}
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              onClick={handleImpersonateUser}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                "Impersonate User"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approve User Confirmation Dialog */}
      <Dialog
        open={!!userToApprove}
        onOpenChange={(open) => !open && setUserToApprove(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve User Waitlist</DialogTitle>
            <DialogDescription>
              {`Are you sure you want to approve waitlist access for ${userToApprove?.email}?`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setUserToApprove(null)}
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              onClick={handleApproveUser}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                "Approve User"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

async function fetchUsersPage(pageSize: number, offset: number) {
  const { data: users } = await authClient.admin.listUsers({
    query: {
      limit: pageSize,
      offset,
      sortBy: "createdAt",
    },
  });
  return users;
}
